use std::fmt::Display;
use std::str::FromStr;
use std::time::SystemTime;

use affine_common::hashcash::Stamp;
use affine_nbstore::storage;
use dashmap::{mapref::one::RefMut, DashMap, Entry};

use crate::error::UniffiError;

mod error;
mod utils;

uniffi::setup_scaffolding!("affine_mobile_native");

#[uniffi::export]
pub fn hashcash_mint(resource: String, bits: u32) -> String {
  Stamp::mint(resource, Some(bits)).format()
}

#[derive(uniffi::Record)]
pub struct DocRecord {
  pub doc_id: String,
  // base64 encoded data
  pub data: String,
  pub timestamp: SystemTime,
}

impl From<affine_nbstore::DocRecord> for DocRecord {
  fn from(record: affine_nbstore::DocRecord) -> Self {
    Self {
      doc_id: record.doc_id,
      data: base64_simd::STANDARD.encode_to_string(&record.data),
      timestamp: record.timestamp.and_utc().into(),
    }
  }
}

impl TryFrom<DocRecord> for affine_nbstore::DocRecord {
  type Error = UniffiError;

  fn try_from(record: DocRecord) -> Result<Self, Self::Error> {
    Ok(Self {
      doc_id: record.doc_id,
      data: base64_simd::STANDARD
        .decode_to_vec(record.data)
        .map_err(|e| UniffiError::Base64DecodingError(e.to_string()))?,
      timestamp: chrono::DateTime::<chrono::Utc>::from(record.timestamp).naive_utc(),
    })
  }
}

#[derive(uniffi::Record)]
pub struct DocUpdate {
  pub doc_id: String,
  pub created_at: SystemTime,
  // base64 encoded data
  pub data: String,
}

impl From<affine_nbstore::DocUpdate> for DocUpdate {
  fn from(update: affine_nbstore::DocUpdate) -> Self {
    Self {
      doc_id: update.doc_id,
      created_at: update.created_at.and_utc().into(),
      data: base64_simd::STANDARD.encode_to_string(&update.data),
    }
  }
}

impl From<DocUpdate> for affine_nbstore::DocUpdate {
  fn from(update: DocUpdate) -> Self {
    Self {
      doc_id: update.doc_id,
      created_at: chrono::DateTime::<chrono::Utc>::from(update.created_at).naive_utc(),
      data: update.data.into(),
    }
  }
}

#[derive(uniffi::Record)]
pub struct DocClock {
  pub doc_id: String,
  pub timestamp: SystemTime,
}

impl From<affine_nbstore::DocClock> for DocClock {
  fn from(clock: affine_nbstore::DocClock) -> Self {
    Self {
      doc_id: clock.doc_id,
      timestamp: clock.timestamp.and_utc().into(),
    }
  }
}

impl From<DocClock> for affine_nbstore::DocClock {
  fn from(clock: DocClock) -> Self {
    Self {
      doc_id: clock.doc_id,
      timestamp: chrono::DateTime::<chrono::Utc>::from(clock.timestamp).naive_utc(),
    }
  }
}

#[derive(uniffi::Record)]
pub struct Blob {
  pub key: String,
  // base64 encoded data
  pub data: String,
  pub mime: String,
  pub size: i64,
  pub created_at: SystemTime,
}

impl From<affine_nbstore::Blob> for Blob {
  fn from(blob: affine_nbstore::Blob) -> Self {
    Self {
      key: blob.key,
      data: base64_simd::STANDARD.encode_to_string(&blob.data),
      mime: blob.mime,
      size: blob.size,
      created_at: blob.created_at.and_utc().into(),
    }
  }
}

#[derive(uniffi::Record)]
pub struct SetBlob {
  pub key: String,
  // base64 encoded data
  pub data: String,
  pub mime: String,
}

impl TryFrom<SetBlob> for affine_nbstore::SetBlob {
  type Error = UniffiError;

  fn try_from(blob: SetBlob) -> Result<Self, Self::Error> {
    Ok(Self {
      key: blob.key,
      data: base64_simd::STANDARD
        .decode_to_vec(blob.data)
        .map_err(|e| UniffiError::Base64DecodingError(e.to_string()))?,
      mime: blob.mime,
    })
  }
}

#[derive(uniffi::Record)]
pub struct ListedBlob {
  pub key: String,
  pub size: i64,
  pub mime: String,
  pub created_at: SystemTime,
}

impl From<affine_nbstore::ListedBlob> for ListedBlob {
  fn from(blob: affine_nbstore::ListedBlob) -> Self {
    Self {
      key: blob.key,
      size: blob.size,
      mime: blob.mime,
      created_at: blob.created_at.and_utc().into(),
    }
  }
}

#[derive(uniffi::Object)]
pub struct DocStoragePool {
  inner: DashMap<String, storage::SqliteDocStorage>,
}

impl DocStoragePool {
  fn ensure_storage<'a>(
    &'a self,
    universal_id: &str,
  ) -> Result<RefMut<'a, String, storage::SqliteDocStorage>, UniffiError> {
    let entry = self.inner.entry(universal_id.to_string());

    if let Entry::Occupied(storage) = entry {
      return Ok(storage.into_ref());
    }
    let options = parse_universal_id(entry.key())?;
    let db_path = utils::get_db_path(&options)?;
    if db_path.is_empty() {
      return Err(UniffiError::EmptyDocStoragePath);
    }
    let storage = storage::SqliteDocStorage::new(db_path);
    Ok(entry.or_insert(storage))
  }
}

#[uniffi::export]
impl DocStoragePool {
  /// Initialize the database and run migrations.
  pub async fn connect(&self, universal_id: String) -> Result<(), UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.connect().await?)
  }

  pub async fn close(&self, universal_id: String) -> Result<(), UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    storage.close().await;
    self.inner.remove(&universal_id);
    Ok(())
  }

  pub fn is_closed(&self, universal_id: String) -> bool {
    let storage = self.ensure_storage(&universal_id).unwrap();
    storage.is_closed()
  }

  pub async fn checkpoint(&self, universal_id: String) -> Result<(), UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.checkpoint().await?)
  }

  pub async fn validate(&self, universal_id: String) -> Result<bool, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.validate().await?)
  }

  pub async fn set_space_id(
    &self,
    universal_id: String,
    space_id: String,
  ) -> Result<(), UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    if space_id.is_empty() {
      return Err(UniffiError::EmptySpaceId);
    }
    Ok(storage.set_space_id(space_id).await?)
  }

  pub async fn push_update(
    &self,
    universal_id: String,
    doc_id: String,
    update: String,
  ) -> Result<SystemTime, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(
      storage
        .push_update(
          doc_id,
          base64_simd::STANDARD
            .decode_to_vec(update)
            .map_err(|e| UniffiError::Base64DecodingError(e.to_string()))?,
        )
        .await?
        .and_utc()
        .into(),
    )
  }

  pub async fn get_doc_snapshot(
    &self,
    universal_id: String,
    doc_id: String,
  ) -> Result<Option<DocRecord>, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.get_doc_snapshot(doc_id).await?.map(Into::into))
  }

  pub async fn set_doc_snapshot(
    &self,
    universal_id: String,
    snapshot: DocRecord,
  ) -> Result<bool, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.set_doc_snapshot(snapshot.try_into()?).await?)
  }

  pub async fn get_doc_updates(
    &self,
    universal_id: String,
    doc_id: String,
  ) -> Result<Vec<DocUpdate>, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(
      storage
        .get_doc_updates(doc_id)
        .await?
        .into_iter()
        .map(Into::into)
        .collect(),
    )
  }

  pub async fn mark_updates_merged(
    &self,
    universal_id: String,
    doc_id: String,
    updates: Vec<SystemTime>,
  ) -> Result<u32, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(
      storage
        .mark_updates_merged(
          doc_id,
          updates
            .into_iter()
            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).naive_utc())
            .collect(),
        )
        .await?,
    )
  }

  pub async fn delete_doc(&self, universal_id: String, doc_id: String) -> Result<(), UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.delete_doc(doc_id).await?)
  }

  pub async fn get_doc_clocks(
    &self,
    universal_id: String,
    after: Option<SystemTime>,
  ) -> Result<Vec<DocClock>, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(
      storage
        .get_doc_clocks(after.map(|t| chrono::DateTime::<chrono::Utc>::from(t).naive_utc()))
        .await?
        .into_iter()
        .map(Into::into)
        .collect(),
    )
  }

  pub async fn get_doc_clock(
    &self,
    universal_id: String,
    doc_id: String,
  ) -> Result<Option<DocClock>, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.get_doc_clock(doc_id).await?.map(Into::into))
  }

  pub async fn get_blob(
    &self,
    universal_id: String,
    key: String,
  ) -> Result<Option<Blob>, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.get_blob(key).await?.map(Into::into))
  }

  pub async fn set_blob(&self, universal_id: String, blob: SetBlob) -> Result<(), UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.set_blob(blob.try_into()?).await?)
  }

  pub async fn delete_blob(
    &self,
    universal_id: String,
    key: String,
    permanently: bool,
  ) -> Result<(), UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.delete_blob(key, permanently).await?)
  }

  pub async fn release_blobs(&self, universal_id: String) -> Result<(), UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.release_blobs().await?)
  }

  pub async fn list_blobs(&self, universal_id: String) -> Result<Vec<ListedBlob>, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(
      storage
        .list_blobs()
        .await?
        .into_iter()
        .map(Into::into)
        .collect(),
    )
  }

  pub async fn get_peer_remote_clocks(
    &self,
    universal_id: String,
    peer: String,
  ) -> Result<Vec<DocClock>, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(
      storage
        .get_peer_remote_clocks(peer)
        .await?
        .into_iter()
        .map(Into::into)
        .collect(),
    )
  }

  pub async fn get_peer_remote_clock(
    &self,
    universal_id: String,
    peer: String,
    doc_id: String,
  ) -> Result<DocClock, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.get_peer_remote_clock(peer, doc_id).await?.into())
  }

  pub async fn set_peer_remote_clock(
    &self,
    universal_id: String,
    peer: String,
    doc_id: String,
    clock: SystemTime,
  ) -> Result<(), UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(
      storage
        .set_peer_remote_clock(
          peer,
          doc_id,
          chrono::DateTime::<chrono::Utc>::from(clock).naive_utc(),
        )
        .await?,
    )
  }

  pub async fn get_peer_pulled_remote_clocks(
    &self,
    universal_id: String,
    peer: String,
  ) -> Result<Vec<DocClock>, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(
      storage
        .get_peer_pulled_remote_clocks(peer)
        .await?
        .into_iter()
        .map(Into::into)
        .collect(),
    )
  }

  pub async fn get_peer_pulled_remote_clock(
    &self,
    universal_id: String,
    peer: String,
    doc_id: String,
  ) -> Result<DocClock, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(
      storage
        .get_peer_pulled_remote_clock(peer, doc_id)
        .await?
        .into(),
    )
  }

  pub async fn set_peer_pulled_remote_clock(
    &self,
    universal_id: String,
    peer: String,
    doc_id: String,
    clock: SystemTime,
  ) -> Result<(), UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(
      storage
        .set_peer_pulled_remote_clock(
          peer,
          doc_id,
          chrono::DateTime::<chrono::Utc>::from(clock).naive_utc(),
        )
        .await?,
    )
  }

  pub async fn get_peer_pushed_clocks(
    &self,
    universal_id: String,
    peer: String,
  ) -> Result<Vec<DocClock>, UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(
      storage
        .get_peer_pushed_clocks(peer)
        .await?
        .into_iter()
        .map(Into::into)
        .collect(),
    )
  }

  pub async fn set_peer_pushed_clock(
    &self,
    universal_id: String,
    peer: String,
    doc_id: String,
    clock: SystemTime,
  ) -> Result<(), UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(
      storage
        .set_peer_pushed_clock(
          peer,
          doc_id,
          chrono::DateTime::<chrono::Utc>::from(clock).naive_utc(),
        )
        .await?,
    )
  }

  pub async fn clear_clocks(&self, universal_id: String) -> Result<(), UniffiError> {
    let storage = self.ensure_storage(&universal_id)?;
    Ok(storage.clear_clocks().await?)
  }
}

#[uniffi::export]
pub fn get_db_path(peer: String, space_type: String, id: String) -> Result<String, UniffiError> {
  let options = StorageOptions {
    peer,
    space_type: SpaceType::from_str(&space_type)?,
    id,
  };
  utils::get_db_path(&options)
}

#[derive(Debug, PartialEq, Eq, Clone, Copy, Default)]
pub enum SpaceType {
  #[default]
  Userspace,
  Workspace,
}

impl Display for SpaceType {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      SpaceType::Userspace => write!(f, "userspace"),
      SpaceType::Workspace => write!(f, "workspace"),
    }
  }
}

impl FromStr for SpaceType {
  type Err = UniffiError;

  fn from_str(s: &str) -> Result<Self, Self::Err> {
    Ok(match s {
      "userspace" => Self::Userspace,
      "workspace" => Self::Workspace,
      _ => return Err(UniffiError::InvalidSpaceType(s.to_string())),
    })
  }
}

pub struct StorageOptions {
  pub peer: String,
  pub space_type: SpaceType,
  pub id: String,
}

pub fn parse_universal_id(id: &str) -> Result<StorageOptions, UniffiError> {
  let mut result = StorageOptions {
    peer: String::new(),
    space_type: SpaceType::default(),
    id: String::new(),
  };

  let mut key = String::new();
  let mut value = String::new();
  let mut is_in_value = false;
  let mut chars = id.chars().peekable();

  while let Some(ch) = chars.next() {
    if is_in_value {
      if ch == ')' && chars.peek() == Some(&';') {
        // Store the collected value in the appropriate field
        match key.as_str() {
          "peer" => result.peer = value.clone(),
          "type" => result.space_type = SpaceType::from_str(&value)?,
          "id" => result.id = value.clone(),
          _ => return Err(UniffiError::InvalidUniversalId(id.to_string())),
        }
        key.clear();
        value.clear();
        is_in_value = false;
        chars.next(); // Skip the semicolon
        continue;
      }
      value.push(ch);
      continue;
    }

    if ch == '@' {
      // Find the position of next '('
      let mut temp_chars = chars.clone();
      let mut found_paren = false;
      let mut key_chars = Vec::new();

      while let Some(next_ch) = temp_chars.next() {
        if next_ch == '(' {
          found_paren = true;
          break;
        }
        key_chars.push(next_ch);
      }

      // Invalid format if no '(' found or it's immediately after '@'
      if !found_paren || key_chars.is_empty() {
        return Err(UniffiError::InvalidUniversalId(id.to_string()));
      }

      key = key_chars.into_iter().collect();
      // Advance the original iterator to the position after the key
      for _ in 0..key.len() + 1 {
        chars.next();
      }
      is_in_value = true;
    } else {
      return Err(UniffiError::InvalidUniversalId(id.to_string()));
    }
  }

  // Validate the parsed results
  if result.peer.is_empty() || result.id.is_empty() {
    return Err(UniffiError::InvalidUniversalId(id.to_string()));
  }

  Ok(result)
}

#[cfg(test)]
mod tests {
  use super::*;

  // ... existing test functions ...

  #[test]
  fn test_universal_id() {
    let options = StorageOptions {
      peer: "123".to_string(),
      space_type: SpaceType::Workspace,
      id: "456".to_string(),
    };

    let id = format!(
      "@peer({});@type({});@id({});",
      options.peer, options.space_type, options.id
    );
    let result = parse_universal_id(&id).unwrap();

    assert_eq!(result.peer, "123");
    assert_eq!(result.space_type, SpaceType::Workspace);
    assert_eq!(result.id, "456");
  }

  #[test]
  fn test_parse_universal_id_valid_cases() {
    let testcases = vec![
      "@peer(123);@type(userspace);@id(456);",
      "@peer(123);@type(workspace);@id(456);",
      "@peer(https://app.affine.pro);@type(userspace);@id(hello:world);",
      "@peer(@name);@type(userspace);@id(@id);",
      "@peer(@peer(name);@type(userspace);@id(@id);",
    ];

    for id in testcases {
      let result = parse_universal_id(id);
      assert!(result.is_ok(), "Failed to parse: {}", id);

      let parsed = result.unwrap();
      assert!(!parsed.peer.is_empty());
      assert!(!parsed.id.is_empty());
    }
  }

  #[test]
  fn test_parse_universal_id_invalid_cases() {
    let testcases = vec![
      // invalid space type
      "@peer(123);@type(anyspace);@id(456);",
      // invalid peer
      "@peer(@peer(name););@type(userspace);@id(@id);",
    ];

    for id in testcases {
      let result = parse_universal_id(id);
      assert!(result.is_err(), "Should have failed to parse: {}", id);

      match result {
        Err(UniffiError::InvalidUniversalId(_)) => (),
        Err(UniffiError::InvalidSpaceType(_)) => (),
        _ => panic!("Expected InvalidUniversalId error for: {}", id),
      }
    }
  }
}
