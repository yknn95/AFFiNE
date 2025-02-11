use std::fs;

#[cfg(not(any(target_os = "ios", target_os = "macos")))]
use homedir::my_home;
#[cfg(any(target_os = "ios", target_os = "macos"))]
use objc2::rc::autoreleasepool;
#[cfg(any(target_os = "ios", target_os = "macos"))]
use objc2_foundation::{NSFileManager, NSSearchPathDirectory, NSSearchPathDomainMask, NSString};

use crate::{error::UniffiError, SpaceType, StorageOptions};

const DB_FILE_NAME: &str = "storage.db";

#[cfg(any(target_os = "ios", target_os = "macos"))]
pub(crate) fn get_db_path(options: &StorageOptions) -> Result<String, UniffiError> {
  let file_manager = unsafe { NSFileManager::defaultManager() };
  // equivalent to Swift:
  // ```swift
  // guard let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
  //   return nil
  // }
  // ```
  let urls = unsafe {
    file_manager.URLsForDirectory_inDomains(
      NSSearchPathDirectory::NSDocumentDirectory,
      NSSearchPathDomainMask::NSUserDomainMask,
    )
  };
  let document_directory = urls
    .first()
    .ok_or(UniffiError::GetUserDocumentDirectoryFailed)?;

  let affine_dir = unsafe {
    let spaces_dir = match options.space_type {
      SpaceType::Userspace => "userspaces",
      SpaceType::Workspace => "workspaces",
    };
    let escaped_peer = escape_filename(&options.peer);
    document_directory
      .URLByAppendingPathComponent(&NSString::from_str(".affine"))
      .and_then(|url| url.URLByAppendingPathComponent(&NSString::from_str(spaces_dir)))
      .and_then(|url| url.URLByAppendingPathComponent(&NSString::from_str(&escaped_peer)))
      .and_then(|url| url.URLByAppendingPathComponent(&NSString::from_str(&options.id)))
  }
  .ok_or(UniffiError::ConcatSpaceDirFailed(format!(
    "{}:{}:{}",
    options.peer, options.space_type, options.id
  )))?;
  let affine_dir_str = autoreleasepool(|pool| {
    Ok::<String, UniffiError>(
      unsafe { affine_dir.path() }
        .ok_or(UniffiError::GetUserDocumentDirectoryFailed)?
        .as_str(pool)
        .to_string(),
    )
  })?;

  // Replicate Swift's appending ".affine" subdir, creating it if necessary
  fs::create_dir_all(&affine_dir_str)
    .map_err(|_| UniffiError::CreateAffineDirFailed(affine_dir_str.clone()))?;

  let db_path = autoreleasepool(|pool| {
    let db_path =
      unsafe { affine_dir.URLByAppendingPathComponent(&NSString::from_str(DB_FILE_NAME)) }.ok_or(
        UniffiError::ConcatSpaceDirFailed(format!(
          "{}:{}:{}/{DB_FILE_NAME}",
          options.peer, options.space_type, options.id
        )),
      )?;
    Ok::<String, UniffiError>(
      unsafe { db_path.path() }
        .ok_or(UniffiError::GetUserDocumentDirectoryFailed)?
        .as_str(pool)
        .to_string(),
    )
  })?;

  Ok(db_path)
}

#[cfg(not(any(target_os = "ios", target_os = "macos")))]
pub(crate) fn get_db_path(options: &StorageOptions) -> Result<String, UniffiError> {
  let home_dir = my_home()
    .map_err(|_| UniffiError::GetUserDocumentDirectoryFailed)?
    .ok_or(UniffiError::GetUserDocumentDirectoryFailed)?;
  let spaces_dir = match options.space_type {
    SpaceType::Userspace => "userspaces",
    SpaceType::Workspace => "workspaces",
  };
  let escaped_peer = escape_filename(&options.peer);
  let db_path = home_dir
    .join(".affine")
    .join(spaces_dir)
    .join(&escaped_peer)
    .join(&options.id);
  fs::create_dir_all(&db_path)
    .map_err(|_| UniffiError::CreateAffineDirFailed(db_path.to_string_lossy().to_string()))?;
  db_path
    .join(DB_FILE_NAME)
    .to_str()
    .map(|p| p.to_owned())
    .ok_or(UniffiError::GetUserDocumentDirectoryFailed)
}

fn escape_filename(name: &str) -> String {
  // First replace special chars with '_'
  let with_underscores = name.replace(|c: char| "\\/!@#$%^&*()+~`\"':;,?<>|".contains(c), "_");

  // Then collapse multiple '_' into single '_'
  let mut result = String::with_capacity(with_underscores.len());
  let mut last_was_underscore = false;

  for c in with_underscores.chars() {
    if c == '_' {
      if !last_was_underscore {
        result.push(c);
      }
      last_was_underscore = true;
    } else {
      result.push(c);
      last_was_underscore = false;
    }
  }

  // Remove trailing underscore
  result.trim_end_matches('_').to_string()
}

#[cfg(all(test, any(target_os = "ios", target_os = "macos")))]
mod tests {
  use super::*;

  #[test]
  fn test_escape_filename() {
    assert_eq!(escape_filename("hello@world"), "hello_world");
    assert_eq!(escape_filename("test!!file"), "test_file");
    assert_eq!(escape_filename("_test_"), "_test"); // Leading underscore preserved
    assert_eq!(escape_filename("multi___under"), "multi_under");
    assert_eq!(escape_filename("path/to\\file"), "path_to_file");
  }
}
