import assert from "node:assert/strict";
import { test } from "node:test";
import { previewKind } from "../components/files/types.ts";

test("previewKind: detects videos, audio, images, documents and sandboxed files", () => {
  // Video files
  for (const name of ["261104_presentation-mstudio.mp4", "clip.WEBM", "video.mov", "reel.m4v", "anim.ogg"]) {
    assert.equal(previewKind(name), "video", name);
  }

  // Audio files
  for (const name of ["podcast.mp3", "interview.wav", "track.m4a", "audio.flac", "speech.aac"]) {
    assert.equal(previewKind(name), "audio", name);
  }

  // Images
  for (const name of ["photo.png", "banner.jpg", "illustration.webp", "icon.ico"]) {
    assert.equal(previewKind(name), "image", name);
  }

  // Documents & Sandboxed
  assert.equal(previewKind("report.pdf"), "pdf");
  assert.equal(previewKind("preview.html"), "sandbox");
  assert.equal(previewKind("logo.svg"), "sandbox");
  assert.equal(previewKind("notes.md"), "text");
  assert.equal(previewKind("config.json"), "text");
  assert.equal(previewKind("archive.zip"), "none");
});
