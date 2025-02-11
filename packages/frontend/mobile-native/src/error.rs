use thiserror::Error;

#[derive(uniffi::Error, Error, Debug)]
pub enum UniffiError {
  #[error("Get user document directory failed")]
  GetUserDocumentDirectoryFailed,
  #[error("Create affine dir failed: {0}")]
  CreateAffineDirFailed(String),
  #[error("Empty doc storage path")]
  EmptyDocStoragePath,
  #[error("Empty space id")]
  EmptySpaceId,
  #[error("Sqlx error: {0}")]
  SqlxError(String),
  #[error("Base64 decoding error: {0}")]
  Base64DecodingError(String),
  #[error("Invalid universal storage id: {0}. It should be in format of @peer($peer);@type($type);@id($id);")]
  InvalidUniversalId(String),
  #[error("Invalid space type: {0}")]
  InvalidSpaceType(String),
  #[error("Concat space dir failed: {0}")]
  ConcatSpaceDirFailed(String),
}

impl From<sqlx::Error> for UniffiError {
  fn from(err: sqlx::Error) -> Self {
    UniffiError::SqlxError(err.to_string())
  }
}
