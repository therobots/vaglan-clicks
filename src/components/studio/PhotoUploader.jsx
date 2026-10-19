const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useRef, useState } from "react";

import { Loader2, Upload } from "lucide-react";

const MAX_PREVIEW_WIDTH = 1440;

/** Downscales a shot to a light, web-friendly preview so the grid loads fast on 4G. */
const makePreview = (file) =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_PREVIEW_WIDTH / img.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          blob ? resolve(blob) : reject(new Error("Could not prepare the preview"));
        },
        "image/jpeg",
        0.82
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image"));
    };
    img.src = objectUrl;
  });

export default function PhotoUploader({ eventId, onUploaded }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || !eventId) return;
    setError("");
    setBusy(true);
    setProgress({ done: 0, total: files.length });

    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const preview = await makePreview(file);
        const previewFile = new File([preview], `${file.name.replace(/\.[^.]+$/, "")}-preview.jpg`, {
          type: "image/jpeg",
        });

        const previewUpload = await db.integrations.Core.UploadPublicFile({ file: previewFile });
        const originalUpload = await db.integrations.Core.UploadPrivateFile({ file });

        const photo = await db.entities.Photo.create({
          event_id: eventId,
          preview_url: previewUpload.file_url,
          original_url: originalUpload.file_uri,
          filename: file.name,
        });

        setProgress({ done: i + 1, total: files.length });
        onUploaded?.(photo);
      }
    } catch (err) {
      setError(err?.message || "That upload did not go through. Please try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        type="button"
        disabled={busy || !eventId}
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#E5E7EB] bg-white py-10 transition-colors active:bg-black/[0.02] disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-black" />
        ) : (
          <Upload className="h-5 w-5 text-black" strokeWidth={2.4} />
        )}
        <span className="text-[13px] font-bold tracking-tight text-black">
          {busy
            ? `Uploading ${progress.done + 1} of ${progress.total}…`
            : "Add photos from this shoot"}
        </span>
        <span className="text-[11px] text-black/40">
          Full-resolution originals are stored privately · previews are stored publicly (anyone with the link can open them)
        </span>
      </button>
      {error && <p className="mt-2 text-[12px] font-medium text-red-600">{error}</p>}
    </div>
  );
}