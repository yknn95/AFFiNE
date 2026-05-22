use llm_adapter::{
  backend::{
    BackendConfig, BackendError, ChatProtocol, DefaultHttpClient, ImageProtocol, dispatch_embedding_request,
    dispatch_rerank_request, dispatch_structured_request, resolve_attachment_reference_plan, resolve_request_intent,
  },
  core::{CoreContent, EmbeddingResponse, ImageResponse, RerankResponse, StructuredResponse},
  router::{
    PreparedChatRoute, PreparedEmbeddingRoute, PreparedImageRoute, PreparedRerankRoute, PreparedStructuredRoute,
    dispatch_embedding_with_fallback, dispatch_image_with_fallback, dispatch_prepared_chat_with_fallback,
    dispatch_rerank_with_fallback, dispatch_structured_with_fallback, prepared_chat_routes_from_serializable,
    prepared_embedding_routes_from_serializable, prepared_image_routes_from_serializable,
    prepared_rerank_routes_from_serializable, prepared_structured_routes_from_serializable,
    serializable_prepared_routes_from_str,
  },
};
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};

use crate::llm::{
  LlmDispatchPayload, LlmEmbeddingDispatchPayload, LlmPreparedImageDispatchRoutePayload, LlmRerankDispatchPayload,
  LlmStructuredDispatchPayload, apply_request_middlewares, apply_structured_request_middlewares,
  core::contracts::LlmImageRequestContract, map_backend_error, map_json_error, parse_embedding_protocol,
  parse_protocol, parse_rerank_protocol, parse_structured_protocol,
};

pub struct AsyncLlmStructuredDispatchTask {
  pub(crate) protocol: String,
  pub(crate) backend_config_json: String,
  pub(crate) request_json: String,
}

pub struct AsyncLlmStructuredDispatchPreparedTask {
  pub(crate) routes_json: String,
}

pub struct AsyncLlmDispatchPreparedTask {
  pub(crate) routes_json: String,
}

#[napi]
impl Task for AsyncLlmDispatchPreparedTask {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    let routes = parse_prepared_dispatch_routes(&self.routes_json)?;
    let (provider_id, response) =
      dispatch_prepared_with_fallback(&DefaultHttpClient::default(), &routes).map_err(map_backend_error)?;

    serde_json::to_string(&serde_json::json!({
      "provider_id": provider_id,
      "response": response,
    }))
    .map_err(map_json_error)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
impl Task for AsyncLlmStructuredDispatchTask {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    let protocol = parse_structured_protocol(&self.protocol)?;
    let config: BackendConfig = serde_json::from_str(&self.backend_config_json).map_err(map_json_error)?;
    let payload: LlmStructuredDispatchPayload = serde_json::from_str(&self.request_json).map_err(map_json_error)?;
    let request =
      apply_structured_request_middlewares(payload.request, &payload.middleware, protocol, config.request_layer)?;

    let response = dispatch_structured_request(&DefaultHttpClient::default(), &config, protocol, &request)
      .map_err(map_backend_error)?;

    serde_json::to_string(&response).map_err(map_json_error)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
impl Task for AsyncLlmStructuredDispatchPreparedTask {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    let (provider_id, response) = dispatch_prepared_structured_routes(&self.routes_json)?;

    serde_json::to_string(&serde_json::json!({
      "provider_id": provider_id,
      "response": response,
    }))
    .map_err(map_json_error)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

pub struct AsyncLlmEmbeddingDispatchTask {
  pub(crate) protocol: String,
  pub(crate) backend_config_json: String,
  pub(crate) request_json: String,
}

pub struct AsyncLlmEmbeddingDispatchPreparedTask {
  pub(crate) routes_json: String,
}

pub struct AsyncLlmImageDispatchPreparedTask {
  pub(crate) routes_json: String,
}

#[napi]
impl Task for AsyncLlmEmbeddingDispatchTask {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    let protocol = parse_embedding_protocol(&self.protocol)?;
    let config: BackendConfig = serde_json::from_str(&self.backend_config_json).map_err(map_json_error)?;
    let payload: LlmEmbeddingDispatchPayload = serde_json::from_str(&self.request_json).map_err(map_json_error)?;

    let response = dispatch_embedding_request(&DefaultHttpClient::default(), &config, protocol, &payload.request)
      .map_err(map_backend_error)?;

    serde_json::to_string(&response).map_err(map_json_error)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
impl Task for AsyncLlmEmbeddingDispatchPreparedTask {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    let routes = parse_prepared_embedding_routes(&self.routes_json)?;
    let (provider_id, response) =
      dispatch_prepared_embedding_with_fallback(&DefaultHttpClient::default(), &routes).map_err(map_backend_error)?;

    serde_json::to_string(&serde_json::json!({
      "provider_id": provider_id,
      "response": response,
    }))
    .map_err(map_json_error)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
impl Task for AsyncLlmImageDispatchPreparedTask {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    let routes = parse_prepared_image_routes(&self.routes_json)?;
    let (provider_id, response) =
      dispatch_image_with_fallback(&DefaultHttpClient::default(), &routes).map_err(map_backend_error)?;

    serde_json::to_string(&serde_json::json!({
      "provider_id": provider_id,
      "response": response,
    }))
    .map_err(map_json_error)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

pub struct AsyncLlmRerankDispatchTask {
  pub(crate) protocol: String,
  pub(crate) backend_config_json: String,
  pub(crate) request_json: String,
}

pub struct AsyncLlmRerankDispatchPreparedTask {
  pub(crate) routes_json: String,
}

#[napi]
impl Task for AsyncLlmRerankDispatchTask {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    let protocol = parse_rerank_protocol(&self.protocol)?;
    let config: BackendConfig = serde_json::from_str(&self.backend_config_json).map_err(map_json_error)?;
    let payload: LlmRerankDispatchPayload = serde_json::from_str(&self.request_json).map_err(map_json_error)?;

    let response = dispatch_rerank_request(&DefaultHttpClient::default(), &config, protocol, &payload.request)
      .map_err(map_backend_error)?;

    serde_json::to_string(&response).map_err(map_json_error)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
impl Task for AsyncLlmRerankDispatchPreparedTask {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    let routes = parse_prepared_rerank_routes(&self.routes_json)?;
    let (provider_id, response) =
      dispatch_prepared_rerank_with_fallback(&DefaultHttpClient::default(), &routes).map_err(map_backend_error)?;

    serde_json::to_string(&serde_json::json!({
      "provider_id": provider_id,
      "response": response,
    }))
    .map_err(map_json_error)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

pub(crate) fn parse_prepared_chat_routes_with_middleware(
  routes_json: &str,
) -> Result<Vec<(PreparedChatRoute, crate::llm::LlmMiddlewarePayload)>> {
  let payload = serializable_prepared_routes_from_str::<LlmDispatchPayload>(routes_json).map_err(map_backend_error)?;
  let middleware = payload
    .iter()
    .map(|route| route.request.middleware.clone())
    .collect::<Vec<_>>();
  let routes = prepared_chat_routes_from_serializable(payload, |request, protocol, request_layer| {
    apply_request_middlewares(request.request, &request.middleware, protocol, request_layer).map_err(|error| {
      BackendError::InvalidRequest {
        field: "middleware.request",
        message: error.reason.clone(),
      }
    })
  })
  .map_err(map_backend_error)?;
  Ok(
    normalize_openai_responses_image_sources(routes)
      .into_iter()
      .zip(middleware)
      .collect(),
  )
}

pub(crate) fn parse_prepared_chat_routes_without_middleware(
  routes_json: &str,
) -> Result<Vec<(PreparedChatRoute, crate::llm::LlmMiddlewarePayload)>> {
  let payload = serializable_prepared_routes_from_str::<LlmDispatchPayload>(routes_json).map_err(map_backend_error)?;
  let middleware = payload
    .iter()
    .map(|route| route.request.middleware.clone())
    .collect::<Vec<_>>();
  let routes =
    prepared_chat_routes_from_serializable(payload, |request, _protocol, _request_layer| Ok(request.request))
      .map_err(map_backend_error)?;
  Ok(
    normalize_openai_responses_image_sources(routes)
      .into_iter()
      .zip(middleware)
      .collect(),
  )
}

fn normalize_openai_responses_image_sources(routes: Vec<PreparedChatRoute>) -> Vec<PreparedChatRoute> {
  routes
    .into_iter()
    .map(|(route, mut request)| {
      if route.protocol == ChatProtocol::OpenaiResponses {
        for message in &mut request.messages {
          for content in &mut message.content {
            if let CoreContent::Image { source } = content {
              normalize_openai_responses_image_source(source);
            }
          }
        }
      }
      (route, request)
    })
    .collect()
}

fn normalize_openai_responses_image_source(source: &mut serde_json::Value) {
  let Some(object) = source.as_object() else {
    return;
  };
  if object.contains_key("url") || object.contains_key("image_url") {
    return;
  }

  let (Some(data), Some(media_type)) = (
    object.get("data").and_then(serde_json::Value::as_str),
    object.get("media_type").and_then(serde_json::Value::as_str),
  ) else {
    return;
  };

  *source = serde_json::Value::String(format!("data:{media_type};base64,{data}"));
}

fn parse_prepared_dispatch_routes(routes_json: &str) -> Result<Vec<PreparedChatRoute>> {
  Ok(
    parse_prepared_chat_routes_with_middleware(routes_json)?
      .into_iter()
      .map(|(route, _)| route)
      .collect(),
  )
}

fn parse_prepared_structured_routes(routes_json: &str) -> Result<Vec<PreparedStructuredRoute>> {
  let payload =
    serializable_prepared_routes_from_str::<LlmStructuredDispatchPayload>(routes_json).map_err(map_backend_error)?;
  prepared_structured_routes_from_serializable(payload, |request, protocol, request_layer| {
    apply_structured_request_middlewares(request.request, &request.middleware, protocol, request_layer).map_err(
      |error| BackendError::InvalidRequest {
        field: "middleware.request",
        message: error.reason.clone(),
      },
    )
  })
  .map_err(map_backend_error)
}

pub(crate) fn dispatch_prepared_structured_routes(routes_json: &str) -> Result<(String, StructuredResponse)> {
  let routes = parse_prepared_structured_routes(routes_json)?;
  dispatch_prepared_structured_with_fallback(&DefaultHttpClient::default(), &routes).map_err(map_backend_error)
}

pub(crate) fn dispatch_prepared_image_route_payloads(
  payload: Vec<LlmPreparedImageDispatchRoutePayload>,
) -> Result<(String, ImageResponse)> {
  let routes = prepared_image_routes_from_payload(payload)?;
  dispatch_image_with_fallback(&DefaultHttpClient::default(), &routes).map_err(map_backend_error)
}

fn parse_prepared_embedding_routes(routes_json: &str) -> Result<Vec<PreparedEmbeddingRoute>> {
  let payload =
    serializable_prepared_routes_from_str::<LlmEmbeddingDispatchPayload>(routes_json).map_err(map_backend_error)?;
  prepared_embedding_routes_from_serializable(payload, |request| Ok(request.request)).map_err(map_backend_error)
}

fn parse_prepared_rerank_routes(routes_json: &str) -> Result<Vec<PreparedRerankRoute>> {
  let payload =
    serializable_prepared_routes_from_str::<LlmRerankDispatchPayload>(routes_json).map_err(map_backend_error)?;
  prepared_rerank_routes_from_serializable(payload, |request| Ok(request.request)).map_err(map_backend_error)
}

fn parse_prepared_image_routes(routes_json: &str) -> Result<Vec<PreparedImageRoute>> {
  let payload =
    serializable_prepared_routes_from_str::<LlmImageRequestContract>(routes_json).map_err(map_backend_error)?;
  prepared_image_routes_from_payload(payload)
}

fn prepared_image_routes_from_payload(
  payload: Vec<LlmPreparedImageDispatchRoutePayload>,
) -> Result<Vec<PreparedImageRoute>> {
  let routes = prepared_image_routes_from_serializable(payload, |request| {
    request
      .try_into()
      .map_err(|error: napi::Error| BackendError::InvalidRequest {
        field: "request",
        message: error.reason.clone(),
      })
  })
  .map_err(map_backend_error)?;

  Ok(
    routes
      .into_iter()
      .map(|(mut route, mut request)| {
        let model = match (route.protocol, request.model()) {
          (ImageProtocol::OpenaiImages, "gpt-image-1") => "gpt-image-2",
          (_, model) => model,
        }
        .to_string();
        request.set_model(model.clone());
        route.model = model;
        (route, request)
      })
      .collect(),
  )
}

fn dispatch_prepared_with_fallback(
  client: &dyn llm_adapter::backend::BackendHttpClient,
  routes: &[PreparedChatRoute],
) -> std::result::Result<(String, llm_adapter::core::CoreResponse), llm_adapter::backend::BackendError> {
  dispatch_prepared_chat_with_fallback(client, routes)
}

fn dispatch_prepared_structured_with_fallback(
  client: &dyn llm_adapter::backend::BackendHttpClient,
  routes: &[PreparedStructuredRoute],
) -> std::result::Result<(String, StructuredResponse), llm_adapter::backend::BackendError> {
  dispatch_structured_with_fallback(client, routes)
}

fn dispatch_prepared_embedding_with_fallback(
  client: &dyn llm_adapter::backend::BackendHttpClient,
  routes: &[PreparedEmbeddingRoute],
) -> std::result::Result<(String, EmbeddingResponse), llm_adapter::backend::BackendError> {
  dispatch_embedding_with_fallback(client, routes)
}

fn dispatch_prepared_rerank_with_fallback(
  client: &dyn llm_adapter::backend::BackendHttpClient,
  routes: &[PreparedRerankRoute],
) -> std::result::Result<(String, RerankResponse), llm_adapter::backend::BackendError> {
  dispatch_rerank_with_fallback(client, routes)
}

#[napi(catch_unwind)]
pub fn llm_dispatch_prepared(routes_json: String) -> AsyncTask<AsyncLlmDispatchPreparedTask> {
  AsyncTask::new(AsyncLlmDispatchPreparedTask { routes_json })
}

#[napi(catch_unwind)]
pub fn llm_structured_dispatch(
  protocol: String,
  backend_config_json: String,
  request_json: String,
) -> AsyncTask<AsyncLlmStructuredDispatchTask> {
  AsyncTask::new(AsyncLlmStructuredDispatchTask {
    protocol,
    backend_config_json,
    request_json,
  })
}

#[napi(catch_unwind)]
pub fn llm_structured_dispatch_prepared(routes_json: String) -> AsyncTask<AsyncLlmStructuredDispatchPreparedTask> {
  AsyncTask::new(AsyncLlmStructuredDispatchPreparedTask { routes_json })
}

#[napi(catch_unwind)]
pub fn llm_embedding_dispatch(
  protocol: String,
  backend_config_json: String,
  request_json: String,
) -> AsyncTask<AsyncLlmEmbeddingDispatchTask> {
  AsyncTask::new(AsyncLlmEmbeddingDispatchTask {
    protocol,
    backend_config_json,
    request_json,
  })
}

#[napi(catch_unwind)]
pub fn llm_embedding_dispatch_prepared(routes_json: String) -> AsyncTask<AsyncLlmEmbeddingDispatchPreparedTask> {
  AsyncTask::new(AsyncLlmEmbeddingDispatchPreparedTask { routes_json })
}

#[napi(catch_unwind)]
pub fn llm_image_dispatch_prepared(routes_json: String) -> AsyncTask<AsyncLlmImageDispatchPreparedTask> {
  AsyncTask::new(AsyncLlmImageDispatchPreparedTask { routes_json })
}

#[napi(catch_unwind)]
pub fn llm_rerank_dispatch(
  protocol: String,
  backend_config_json: String,
  request_json: String,
) -> AsyncTask<AsyncLlmRerankDispatchTask> {
  AsyncTask::new(AsyncLlmRerankDispatchTask {
    protocol,
    backend_config_json,
    request_json,
  })
}

#[napi(catch_unwind)]
pub fn llm_rerank_dispatch_prepared(routes_json: String) -> AsyncTask<AsyncLlmRerankDispatchPreparedTask> {
  AsyncTask::new(AsyncLlmRerankDispatchPreparedTask { routes_json })
}

#[napi(catch_unwind)]
pub fn llm_plan_attachment_reference(
  protocol: String,
  backend_config_json: String,
  source_json: String,
) -> Result<String> {
  let protocol = parse_protocol(&protocol)?;
  let config: BackendConfig = serde_json::from_str(&backend_config_json).map_err(map_json_error)?;
  let source: serde_json::Value = serde_json::from_str(&source_json).map_err(map_json_error)?;
  let plan = resolve_attachment_reference_plan(&config, &protocol, &source).map_err(map_backend_error)?;

  serde_json::to_string(&plan).map_err(map_json_error)
}

#[napi(catch_unwind)]
pub fn llm_resolve_request_intent(
  protocol: String,
  backend_config_json: String,
  intent_json: String,
) -> Result<String> {
  let protocol = parse_protocol(&protocol)?;
  let config: BackendConfig = serde_json::from_str(&backend_config_json).map_err(map_json_error)?;
  let intent: llm_adapter::backend::RequestIntent = serde_json::from_str(&intent_json).map_err(map_json_error)?;
  let resolved = resolve_request_intent(&config, &protocol, intent).map_err(map_backend_error)?;

  serde_json::to_string(&resolved).map_err(map_json_error)
}

#[cfg(test)]
mod tests {
  use std::collections::BTreeMap;

  use serde_json::json;

  use super::*;
  use llm_adapter::{
    backend::{BackendConfig, ChatProtocol},
    core::{CoreContent, CoreMessage, CoreRequest, CoreRole},
    router::RoutedBackend,
  };

  #[test]
  fn prepared_image_routes_use_nested_request_model() {
    let payload = serde_json::from_value::<Vec<LlmPreparedImageDispatchRoutePayload>>(json!([
      {
        "provider_id": "openai-primary",
        "protocol": "openai_images",
        "model": "gpt-image-1",
        "config": {
          "base_url": "https://api.openai.com",
          "auth_token": "test-key",
          "request_layer": "openai_images"
        },
        "request": {
          "model": "gpt-image-2",
          "prompt": "draw",
          "operation": "generate"
        }
      }
    ]))
    .expect("prepared image route payload should deserialize");

    let routes = prepared_image_routes_from_payload(payload).expect("prepared routes");

    assert_eq!(routes[0].0.model, "gpt-image-2");
    assert_eq!(routes[0].1.model(), "gpt-image-2");
  }

  #[test]
  fn prepared_openai_image_routes_upgrade_deprecated_gpt_image_1() {
    let payload = serde_json::from_value::<Vec<LlmPreparedImageDispatchRoutePayload>>(json!([
      {
        "provider_id": "openai-primary",
        "protocol": "openai_images",
        "model": "gpt-image-1",
        "config": {
          "base_url": "https://api.openai.com",
          "auth_token": "test-key",
          "request_layer": "openai_images"
        },
        "request": {
          "model": "gpt-image-1",
          "prompt": "draw",
          "operation": "generate"
        }
      }
    ]))
    .expect("prepared image route payload should deserialize");

    let routes = prepared_image_routes_from_payload(payload).expect("prepared routes");

    assert_eq!(routes[0].0.model, "gpt-image-2");
    assert_eq!(routes[0].1.model(), "gpt-image-2");
  }

  #[test]
  fn openai_responses_image_data_sources_become_image_urls() {
    let routes = normalize_openai_responses_image_sources(vec![(
      RoutedBackend {
        provider_id: "openai-primary".to_string(),
        protocol: ChatProtocol::OpenaiResponses,
        model: "gpt-5.5".to_string(),
        config: BackendConfig {
          base_url: "https://api.openai.com".to_string(),
          auth_token: "test-key".to_string(),
          request_layer: None,
          headers: BTreeMap::new(),
          no_streaming: false,
          timeout_ms: None,
        },
      },
      CoreRequest {
        model: "gpt-5.5".to_string(),
        messages: vec![CoreMessage {
          role: CoreRole::User,
          content: vec![CoreContent::Image {
            source: json!({
              "data": "aW1n",
              "media_type": "image/png"
            }),
          }],
        }],
        stream: true,
        max_tokens: None,
        temperature: None,
        tools: vec![],
        tool_choice: None,
        include: None,
        reasoning: None,
        response_schema: None,
      },
    )]);

    let CoreContent::Image { source } = &routes[0].1.messages[0].content[0] else {
      panic!("expected image content");
    };
    assert_eq!(source, "data:image/png;base64,aW1n");
  }
}
