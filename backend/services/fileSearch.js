const fs = require('fs');
const path = require('path');
const { getSetting } = require('../database');

let fileCache = [];
let lastCacheTime = 0;
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function walkDir(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath, fileList);
      } else if (file.match(/\.(mp3|flac|m4a|ogg)$/i)) {
        fileList.push({
          normalized: normalizeString(fullPath),
          original: fullPath
        });
      }
    }
  } catch (err) {
    console.error(`[FileSearch] Error reading directory ${dir}:`, err.message);
  }
  return fileList;
}

async function buildFileCache() {
  const mountPath = await getSetting('navidrome_library_path', '/music');
  if (!fs.existsSync(mountPath)) {
    console.log(`[FileSearch] Warning: Directory ${mountPath} does not exist. Skipping file search.`);
    return;
  }

  fileCache = walkDir(mountPath);
  lastCacheTime = Date.now();
  console.log(`[FileSearch] Indexed ${fileCache.length} local files in cache.`);
}

/**
 * Checks if a track is already downloaded by searching local files.
 * Rebuilds cache if expired.
 */
async function isAlreadyDownloaded(artist, title) {
  if (Date.now() - lastCacheTime > CACHE_TTL || fileCache.length === 0) {
    await buildFileCache();
  }

  const artNorm = normalizeString(artist);
  const titleNorm = normalizeString(title);

  // If we can't normalize properly, skip filtering
  if (!artNorm || !titleNorm) return false;

  for (const item of fileCache) {
    // Check if the path contains BOTH the artist and the title somewhere
    if (item.normalized.includes(artNorm) && item.normalized.includes(titleNorm)) {
      return true;
    }
  }
  return false;
}

/**
 * Attempts to find and delete a local file matching the artist and title.
 * Used when a user explicitly dislikes a track that might have already been downloaded.
 */
async function deleteLocalFile(artist, title) {
  if (Date.now() - lastCacheTime > CACHE_TTL || fileCache.length === 0) {
    await buildFileCache();
  }

  const artNorm = normalizeString(artist);
  const titleNorm = normalizeString(title);

  if (!artNorm || !titleNorm) return false;

  for (let i = 0; i < fileCache.length; i++) {
    const item = fileCache[i];
    if (item.normalized.includes(artNorm) && item.normalized.includes(titleNorm)) {
      try {
        if (fs.existsSync(item.original)) {
          fs.unlinkSync(item.original);
          console.log(`[FileSearch] Deleted disliked file: ${item.original}`);
          // Remove from cache
          fileCache.splice(i, 1);
          return true;
        }
      } catch (err) {
        console.error(`[FileSearch] Failed to delete file ${item.original}:`, err.message);
      }
    }
  }
  return false;
}

module.exports = { isAlreadyDownloaded, buildFileCache, deleteLocalFile };
