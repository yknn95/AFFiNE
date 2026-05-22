use std::sync::{
  Arc,
  atomic::{AtomicBool, Ordering},
};

use llm_adapter::{
  backend::{BackendConfig, BackendError, ChatProtocol, DefaultHttpClient},
  core::{CoreContent, CoreMessage, CoreRequest, CoreRole},
  router::{PreparedChatRoute, RoutedBackend, dispatch_prepared_stream_with_fallback_index},
};
use llm_runtime::{
  AccumulatedToolCall, EventSink, RoundOutcome, RoundProcessorError, ToolExecutor, ToolLoopEvent, ToolResultMessage,
  run_prepared_stream_round_with_fallback,
};
use napi::{
  bindgen_prelude::PromiseRaw,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};

use super::{
  super::emit_provider_selected_event,
  callback::{NapiEventSink, NapiToolExecutor, emit_tool_loop_event},
};
use crate::llm::{
  LlmDispatchPayload, LlmMiddlewarePayload, LlmStreamHandle, STREAM_ABORTED_REASON,
  STREAM_CALLBACK_DISPATCH_FAILED_REASON, STREAM_END_MARKER, StreamPipeline, apply_request_middlewares,
  backend_transport_error, emit_error_event, resolve_stream_chain,
};

pub(crate) type PreparedToolLoopRoute = (PreparedChatRoute, LlmMiddlewarePayload);

struct ToolLoopRound {
  outcome: RoundOutcome,
  reasoning: Option<String>,
}

fn join_reasoning_parts(parts: Vec<String>) -> Option<String> {
  let reasoning = parts.concat();
  if reasoning.is_empty() { None } else { Some(reasoning) }
}

fn replay_reasoning(reasoning: Option<String>, tool_calls: &[AccumulatedToolCall]) -> Option<String> {
  if reasoning.as_deref().is_some_and(|text| !text.is_empty()) {
    return reasoning;
  }

  join_reasoning_parts(
    tool_calls
      .iter()
      .filter_map(|call| call.thought.clone())
      .filter(|thought| !thought.is_empty())
      .collect(),
  )
}

fn dispatch_prepared_round_with_fallback(
  routes: &[PreparedToolLoopRoute],
  callback: &ThreadsafeFunction<String, ()>,
  aborted: &AtomicBool,
  emitted: &AtomicBool,
) -> std::result::Result<ToolLoopRound, BackendError> {
  let adapter_routes = routes.iter().map(|(route, _)| route.clone()).collect::<Vec<_>>();
  let mut pipelines = routes
    .iter()
    .map(|(_, middleware)| {
      let chain =
        resolve_stream_chain(&middleware.stream).map_err(|error| backend_transport_error(error.reason.clone()))?;
      Ok(StreamPipeline::new(chain, middleware.config.clone()))
    })
    .collect::<std::result::Result<Vec<_>, BackendError>>()?;

  let mut selected_provider_id: Option<String> = None;
  let mut reasoning_parts = Vec::new();
  let outcome = run_prepared_stream_round_with_fallback(
    &mut pipelines,
    |on_event| {
      let (selected_index, provider_id) =
        dispatch_prepared_stream_with_fallback_index(&DefaultHttpClient::default(), &adapter_routes, on_event)?;
      selected_provider_id = Some(provider_id);
      Ok(selected_index)
    },
    || aborted.load(Ordering::Relaxed),
    || backend_transport_error(STREAM_ABORTED_REASON),
    |error: RoundProcessorError| backend_transport_error(error.to_string()),
    |loop_event| {
      if let ToolLoopEvent::ReasoningDelta { text } = loop_event
        && !text.is_empty()
      {
        reasoning_parts.push(text.clone());
      }
      emitted.store(true, Ordering::Relaxed);
      emit_tool_loop_event(callback, loop_event)
    },
  )?;
  if let Some(provider_id) = selected_provider_id {
    emit_provider_selected_event(callback, provider_id);
  }
  Ok(ToolLoopRound {
    outcome,
    reasoning: join_reasoning_parts(reasoning_parts),
  })
}

fn prepare_tool_loop_route(
  route: &RoutedBackend,
  request: &CoreRequest,
  middleware: &LlmMiddlewarePayload,
) -> std::result::Result<PreparedToolLoopRoute, BackendError> {
  let mut routed_request =
    apply_request_middlewares(request.clone(), middleware, route.protocol, route.config.request_layer)
      .map_err(|error| backend_transport_error(error.reason.clone()))?;
  routed_request.model = route.model.clone();

  Ok(((route.clone(), routed_request), middleware.clone()))
}

fn dispatch_round(
  route: &RoutedBackend,
  request: &CoreRequest,
  callback: &ThreadsafeFunction<String, ()>,
  middleware: &LlmMiddlewarePayload,
  aborted: &AtomicBool,
  emitted: &AtomicBool,
) -> std::result::Result<ToolLoopRound, BackendError> {
  let prepared = vec![prepare_tool_loop_route(route, request, middleware)?];
  dispatch_prepared_round_with_fallback(&prepared, callback, aborted, emitted)
}

fn dispatch_round_with_fallback(
  routes: &[RoutedBackend],
  request: &CoreRequest,
  callback: &ThreadsafeFunction<String, ()>,
  middleware: &LlmMiddlewarePayload,
  aborted: &AtomicBool,
  emitted: &AtomicBool,
) -> std::result::Result<ToolLoopRound, BackendError> {
  let prepared = routes
    .iter()
    .map(|route| prepare_tool_loop_route(route, request, middleware))
    .collect::<std::result::Result<Vec<_>, BackendError>>()?;

  dispatch_prepared_round_with_fallback(&prepared, callback, aborted, emitted)
}

fn dispatch_prepared_payload_round_with_fallback(
  routes: &[PreparedToolLoopRoute],
  request: &CoreRequest,
  callback: &ThreadsafeFunction<String, ()>,
  aborted: &AtomicBool,
  emitted: &AtomicBool,
) -> std::result::Result<ToolLoopRound, BackendError> {
  let prepared = routes
    .iter()
    .map(|((route, _), middleware)| prepare_tool_loop_route(route, request, middleware))
    .collect::<std::result::Result<Vec<_>, BackendError>>()?;

  dispatch_prepared_round_with_fallback(&prepared, callback, aborted, emitted)
}

fn run_native_tool_loop_with_dispatch<F>(
  payload: LlmDispatchPayload,
  max_steps: usize,
  callback: &ThreadsafeFunction<String, ()>,
  tool_callback: &ThreadsafeFunction<String, PromiseRaw<'static, String>>,
  aborted: Arc<AtomicBool>,
  emitted: &AtomicBool,
  dispatch_round_fn: F,
) -> std::result::Result<(), BackendError>
where
  F: Fn(
    &CoreRequest,
    &ThreadsafeFunction<String, ()>,
    &AtomicBool,
    &AtomicBool,
  ) -> std::result::Result<ToolLoopRound, BackendError>,
{
  let mut messages = payload.request.messages.clone();
  let mut tool_executor = NapiToolExecutor::new(tool_callback);
  let mut event_sink = NapiEventSink::new_with_emitted(callback, emitted);

  for step in 0..max_steps {
    if aborted.load(Ordering::Relaxed) {
      return Err(backend_transport_error(STREAM_ABORTED_REASON));
    }

    let request = CoreRequest {
      messages: messages.to_vec(),
      stream: true,
      ..payload.request.clone()
    };
    let round = dispatch_round_fn(&request, callback, &aborted, emitted)?;

    if round.outcome.tool_calls.is_empty() {
      if let Some(done) = round.outcome.final_done {
        event_sink.emit(&done)?;
      }
      return Ok(());
    }

    if step == max_steps - 1 {
      return Err(backend_transport_error("ToolCallLoop max steps reached"));
    }

    let mut replay_results = Vec::with_capacity(round.outcome.tool_calls.len());
    for call in &round.outcome.tool_calls {
      let result = tool_executor.execute(call)?;
      event_sink.emit(&ToolLoopEvent::ToolResult {
        call_id: result.call_id.clone(),
        name: result.name.clone(),
        arguments: result.arguments.clone(),
        arguments_text: result.arguments_text.clone(),
        arguments_error: result.arguments_error.clone(),
        output: result.output.clone(),
        is_error: result.is_error,
      })?;
      replay_results.push(ToolResultMessage {
        call_id: result.call_id,
        output: result.output,
        is_error: result.is_error,
      });
    }

    append_tool_turns_with_reasoning(
      &mut messages,
      replay_reasoning(round.reasoning, &round.outcome.tool_calls),
      &round.outcome.tool_calls,
      &replay_results,
    );
  }

  Ok(())
}

fn append_tool_turns_with_reasoning(
  messages: &mut Vec<CoreMessage>,
  reasoning: Option<String>,
  tool_calls: &[AccumulatedToolCall],
  tool_results: &[ToolResultMessage],
) {
  let mut assistant_content = Vec::with_capacity(tool_calls.len() + usize::from(reasoning.is_some()));
  if let Some(reasoning) = reasoning
    && !reasoning.is_empty()
  {
    assistant_content.push(CoreContent::Reasoning {
      text: reasoning,
      signature: None,
    });
  }
  assistant_content.extend(tool_calls.iter().map(|call| CoreContent::ToolCall {
    call_id: call.id.clone(),
    name: call.name.clone(),
    arguments: call.args.clone(),
    thought: call.thought.clone(),
  }));

  messages.push(CoreMessage {
    role: CoreRole::Assistant,
    content: assistant_content,
  });

  for result in tool_results {
    messages.push(CoreMessage {
      role: CoreRole::Tool,
      content: vec![CoreContent::ToolResult {
        call_id: result.call_id.clone(),
        output: result.output.clone(),
        is_error: result.is_error,
      }],
    });
  }
}

fn run_native_tool_loop(
  route: RoutedBackend,
  payload: LlmDispatchPayload,
  max_steps: usize,
  callback: &ThreadsafeFunction<String, ()>,
  tool_callback: &ThreadsafeFunction<String, PromiseRaw<'static, String>>,
  aborted: Arc<AtomicBool>,
  emitted: &AtomicBool,
) -> std::result::Result<(), BackendError> {
  let middleware = payload.middleware.clone();
  run_native_tool_loop_with_dispatch(
    payload,
    max_steps,
    callback,
    tool_callback,
    aborted,
    emitted,
    |request, callback, aborted, emitted| dispatch_round(&route, request, callback, &middleware, aborted, emitted),
  )
}

fn run_native_routed_tool_loop(
  routes: Vec<RoutedBackend>,
  payload: LlmDispatchPayload,
  max_steps: usize,
  callback: &ThreadsafeFunction<String, ()>,
  tool_callback: &ThreadsafeFunction<String, PromiseRaw<'static, String>>,
  aborted: Arc<AtomicBool>,
  emitted: &AtomicBool,
) -> std::result::Result<(), BackendError> {
  let middleware = payload.middleware.clone();
  run_native_tool_loop_with_dispatch(
    payload,
    max_steps,
    callback,
    tool_callback,
    aborted,
    emitted,
    |request, callback, aborted, emitted| {
      dispatch_round_with_fallback(&routes, request, callback, &middleware, aborted, emitted)
    },
  )
}

pub(crate) fn run_native_prepared_tool_loop(
  routes: Vec<PreparedToolLoopRoute>,
  max_steps: usize,
  callback: &ThreadsafeFunction<String, ()>,
  tool_callback: &ThreadsafeFunction<String, PromiseRaw<'static, String>>,
  aborted: Arc<AtomicBool>,
) -> std::result::Result<(), BackendError> {
  let Some(((_, request), middleware)) = routes.first() else {
    return Err(BackendError::NoBackendAvailable);
  };
  let payload = LlmDispatchPayload {
    request: request.clone(),
    middleware: middleware.clone(),
  };
  let emitted = AtomicBool::new(false);

  run_native_tool_loop_with_dispatch(
    payload,
    max_steps,
    callback,
    tool_callback,
    aborted,
    &emitted,
    |request, callback, aborted, emitted| {
      dispatch_prepared_payload_round_with_fallback(&routes, request, callback, aborted, emitted)
    },
  )
}

pub(crate) fn spawn_tool_loop_stream(
  protocol: ChatProtocol,
  config: BackendConfig,
  payload: LlmDispatchPayload,
  max_steps: usize,
  callback: ThreadsafeFunction<String, ()>,
  tool_callback: ThreadsafeFunction<String, PromiseRaw<'static, String>>,
) -> LlmStreamHandle {
  let aborted = Arc::new(AtomicBool::new(false));
  let aborted_in_worker = aborted.clone();

  std::thread::spawn(move || {
    let emitted = AtomicBool::new(false);
    let result = run_native_tool_loop(
      RoutedBackend {
        provider_id: String::new(),
        protocol,
        model: payload.request.model.clone(),
        config,
      },
      payload,
      max_steps,
      &callback,
      &tool_callback,
      aborted_in_worker.clone(),
      &emitted,
    );
    let callback_dispatch_failed = matches!(
      &result,
      Err(BackendError::Transport { message: reason })
        if reason.starts_with(STREAM_CALLBACK_DISPATCH_FAILED_REASON)
    );

    if let Err(error) = result
      && !aborted_in_worker.load(Ordering::Relaxed)
      && !matches!(&error, BackendError::Transport { message: reason } if reason == STREAM_ABORTED_REASON)
      && !callback_dispatch_failed
    {
      emit_error_event(&callback, error.to_string(), "dispatch_error");
    }

    if !aborted_in_worker.load(Ordering::Relaxed) && !callback_dispatch_failed {
      let _ = callback.call(
        Ok(STREAM_END_MARKER.to_string()),
        ThreadsafeFunctionCallMode::NonBlocking,
      );
    }
  });

  LlmStreamHandle { aborted }
}

pub(crate) fn spawn_routed_tool_loop_stream(
  routes: Vec<RoutedBackend>,
  payload: LlmDispatchPayload,
  max_steps: usize,
  callback: ThreadsafeFunction<String, ()>,
  tool_callback: ThreadsafeFunction<String, PromiseRaw<'static, String>>,
) -> LlmStreamHandle {
  let aborted = Arc::new(AtomicBool::new(false));
  let aborted_in_worker = aborted.clone();

  std::thread::spawn(move || {
    let emitted = AtomicBool::new(false);
    let result = run_native_routed_tool_loop(
      routes,
      payload,
      max_steps,
      &callback,
      &tool_callback,
      aborted_in_worker.clone(),
      &emitted,
    );
    let callback_dispatch_failed = matches!(
      &result,
      Err(BackendError::Transport { message: reason })
        if reason.starts_with(STREAM_CALLBACK_DISPATCH_FAILED_REASON)
    );

    if let Err(error) = result
      && !aborted_in_worker.load(Ordering::Relaxed)
      && !matches!(&error, BackendError::Transport { message: reason } if reason == STREAM_ABORTED_REASON)
      && !callback_dispatch_failed
    {
      emit_error_event(&callback, error.to_string(), "dispatch_error");
    }

    if !aborted_in_worker.load(Ordering::Relaxed) && !callback_dispatch_failed {
      let _ = callback.call(
        Ok(STREAM_END_MARKER.to_string()),
        ThreadsafeFunctionCallMode::NonBlocking,
      );
    }
  });

  LlmStreamHandle { aborted }
}

pub(crate) fn spawn_prepared_tool_loop_stream(
  routes: Vec<PreparedToolLoopRoute>,
  max_steps: usize,
  callback: ThreadsafeFunction<String, ()>,
  tool_callback: ThreadsafeFunction<String, PromiseRaw<'static, String>>,
) -> LlmStreamHandle {
  let aborted = Arc::new(AtomicBool::new(false));
  let aborted_in_worker = aborted.clone();

  std::thread::spawn(move || {
    let result = run_native_prepared_tool_loop(routes, max_steps, &callback, &tool_callback, aborted_in_worker.clone());
    let callback_dispatch_failed = matches!(
      &result,
      Err(BackendError::Transport { message: reason })
        if reason.starts_with(STREAM_CALLBACK_DISPATCH_FAILED_REASON)
    );

    if let Err(error) = result
      && !aborted_in_worker.load(Ordering::Relaxed)
      && !matches!(&error, BackendError::Transport { message: reason } if reason == STREAM_ABORTED_REASON)
      && !callback_dispatch_failed
    {
      emit_error_event(&callback, error.to_string(), "dispatch_error");
    }

    if !aborted_in_worker.load(Ordering::Relaxed) && !callback_dispatch_failed {
      let _ = callback.call(
        Ok(STREAM_END_MARKER.to_string()),
        ThreadsafeFunctionCallMode::NonBlocking,
      );
    }
  });

  LlmStreamHandle { aborted }
}

#[cfg(test)]
mod tests {
  use llm_adapter::core::{CoreContent, CoreMessage, CoreRole};
  use llm_runtime::{AccumulatedToolCall, ToolResultMessage};
  use serde_json::json;

  use super::append_tool_turns_with_reasoning;

  #[test]
  fn should_replay_reasoning_content_before_tool_calls() {
    let mut messages = vec![CoreMessage {
      role: CoreRole::User,
      content: vec![CoreContent::Text {
        text: "read the current doc".to_string(),
      }],
    }];

    append_tool_turns_with_reasoning(
      &mut messages,
      Some("I need to inspect the document first.".to_string()),
      &[AccumulatedToolCall {
        id: "call_1".to_string(),
        name: "doc_read".to_string(),
        args: json!({ "docId": "doc_1" }),
        raw_arguments_text: None,
        argument_parse_error: None,
        thought: None,
      }],
      &[ToolResultMessage {
        call_id: "call_1".to_string(),
        output: json!({ "markdown": "# Draft" }),
        is_error: Some(false),
      }],
    );

    assert_eq!(messages.len(), 3);
    assert!(matches!(messages[1].role, CoreRole::Assistant));
    assert!(matches!(
      messages[1].content.as_slice(),
      [
        CoreContent::Reasoning { text, signature: None },
        CoreContent::ToolCall { call_id, name, .. },
      ] if text == "I need to inspect the document first." && call_id == "call_1" && name == "doc_read"
    ));
    assert!(matches!(messages[2].role, CoreRole::Tool));
  }

  #[test]
  fn should_replay_tool_call_thought_as_reasoning_content() {
    let mut messages = vec![CoreMessage {
      role: CoreRole::User,
      content: vec![CoreContent::Text {
        text: "read the current doc".to_string(),
      }],
    }];
    let tool_calls = vec![AccumulatedToolCall {
      id: "call_1".to_string(),
      name: "doc_read".to_string(),
      args: json!({ "docId": "doc_1" }),
      raw_arguments_text: None,
      argument_parse_error: None,
      thought: Some("Need document context.".to_string()),
    }];

    append_tool_turns_with_reasoning(
      &mut messages,
      super::replay_reasoning(None, &tool_calls),
      &tool_calls,
      &[ToolResultMessage {
        call_id: "call_1".to_string(),
        output: json!({ "markdown": "# Draft" }),
        is_error: Some(false),
      }],
    );

    assert!(matches!(
      messages[1].content.as_slice(),
      [
        CoreContent::Reasoning { text, signature: None },
        CoreContent::ToolCall { call_id, .. },
      ] if text == "Need document context." && call_id == "call_1"
    ));
  }
}
