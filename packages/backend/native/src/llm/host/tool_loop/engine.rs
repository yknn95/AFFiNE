use std::sync::{
  Arc,
  atomic::{AtomicBool, Ordering},
};

use llm_adapter::{
  backend::{BackendConfig, BackendError, ChatProtocol, DefaultHttpClient},
  core::CoreRequest,
  router::{PreparedChatRoute, RoutedBackend, dispatch_prepared_stream_with_fallback_index},
};
use llm_runtime::{RoundOutcome, RoundProcessorError, run_prepared_stream_round_with_fallback, run_tool_loop};
use napi::{
  bindgen_prelude::PromiseRaw,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use serde_json::{Value, json};

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

const RESPONSE_IMAGE_LOG_PREFIX: &str = "[responses-image-bridge]";

fn dispatch_prepared_round_with_fallback(
  routes: &[PreparedToolLoopRoute],
  callback: &ThreadsafeFunction<String, ()>,
  aborted: &AtomicBool,
  emitted: &AtomicBool,
) -> std::result::Result<RoundOutcome, BackendError> {
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
      emitted.store(true, Ordering::Relaxed);
      emit_tool_loop_event(callback, loop_event)
    },
  )?;
  emit_response_image_tool_result(callback, &outcome)?;
  if let Some(provider_id) = selected_provider_id {
    emit_provider_selected_event(callback, provider_id);
  }
  Ok(outcome)
}

fn emit_response_image_tool_result(
  callback: &ThreadsafeFunction<String, ()>,
  outcome: &RoundOutcome,
) -> std::result::Result<(), BackendError> {
  let outcome_debug = format!("{outcome:?}");
  let images = extract_response_images_from_debug(&outcome_debug);
  if images.is_empty() {
    println!(
      "{RESPONSE_IMAGE_LOG_PREFIX} no_images debugPreview={}",
      truncate_for_log(&outcome_debug, 200)
    );
    return Ok(());
  }

  let prompt = None::<String>;
  let call_id = "response_image_generate".to_string();
  let event = json!({
    "type": "tool_result",
    "call_id": format!("responses_{call_id}"),
    "name": "image_generate",
    "arguments": {
      "source": "responses_output",
      "count": images.len(),
    },
    "output": {
      "source": "responses_output",
      "prompt": prompt,
      "images": images,
    },
  });

  println!(
    "{RESPONSE_IMAGE_LOG_PREFIX} emit_tool_result callId={} imageCount={} promptPreview={} imagePreview={}",
    format!("responses_{call_id}"),
    images.len(),
    truncate_for_log(prompt.as_deref().unwrap_or(""), 120),
    truncate_for_log(&serde_json::to_string(&images).unwrap_or_default(), 200)
  );

  emit_tool_loop_event(callback, &event)
}

fn extract_response_images_from_debug(text: &str) -> Vec<Value> {
  let mut images = Vec::new();
  let mut search_from = 0usize;
  while let Some(type_index) = text[search_from..].find("image_generation_call") {
    let absolute = search_from + type_index;
    let tail = &text[absolute..];
    let result = extract_debug_field(tail, "result");
    let revised_prompt = extract_debug_field(tail, "revised_prompt");
    let id = extract_debug_field(tail, "id");
    if let Some(result) = result {
      println!(
        "{RESPONSE_IMAGE_LOG_PREFIX} found_call id={} revisedPrompt={} resultLength={}",
        id.as_deref().unwrap_or("n/a"),
        truncate_for_log(revised_prompt.as_deref().unwrap_or(""), 120),
        result.len()
      );
      let mut image = serde_json::Map::new();
      image.insert("b64_json".to_string(), Value::String(result));
      image.insert(
        "mimeType".to_string(),
        Value::String("image/png".to_string()),
      );
      if let Some(revised_prompt) = revised_prompt {
        image.insert(
          "revised_prompt".to_string(),
          Value::String(revised_prompt),
        );
      }
      if let Some(id) = id {
        image.insert("id".to_string(), Value::String(id));
      }
      images.push(Value::Object(image));
    }
    search_from = absolute + "image_generation_call".len();
  }
  images
}

fn extract_debug_field(text: &str, field: &str) -> Option<String> {
  let needle = format!("{field}: ");
  let index = text.find(&needle)?;
  let tail = &text[index + needle.len()..];

  if let Some(rest) = tail.strip_prefix("Some(\"") {
    let end = rest.find("\")")?;
    return Some(rest[..end].to_string());
  }

  if let Some(rest) = tail.strip_prefix('"') {
    let end = rest.find('"')?;
    return Some(rest[..end].to_string());
  }

  None
}

fn truncate_for_log(value: &str, max: usize) -> String {
  if value.len() > max {
    format!("{}...", &value[..max])
  } else {
    value.to_string()
  }
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
) -> std::result::Result<RoundOutcome, BackendError> {
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
) -> std::result::Result<RoundOutcome, BackendError> {
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
) -> std::result::Result<RoundOutcome, BackendError> {
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
  ) -> std::result::Result<RoundOutcome, BackendError>,
{
  let mut messages = payload.request.messages.clone();
  let tool_executor = NapiToolExecutor::new(tool_callback);
  let event_sink = NapiEventSink::new_with_emitted(callback, emitted);
  run_tool_loop(
    &mut messages,
    max_steps,
    |messages| {
      if aborted.load(Ordering::Relaxed) {
        return Err(backend_transport_error(STREAM_ABORTED_REASON));
      }

      let request = CoreRequest {
        messages: messages.to_vec(),
        stream: true,
        ..payload.request.clone()
      };

      dispatch_round_fn(&request, callback, &aborted, emitted)
    },
    tool_executor,
    event_sink,
    || backend_transport_error("ToolCallLoop max steps reached"),
  )
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
