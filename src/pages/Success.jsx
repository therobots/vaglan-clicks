import { useEffect, useState } from "react";
import { CheckCircle2, Download, LoaderCircle } from "lucide-react";
import { supabase } from "@/supabaseClient";
import { cacheCartSelection } from "@/lib/orderSession";
import { edgeFunctionErrorMessage } from "@/lib/edgeFunctionError";
import { applyDocumentLanguage, galleryText, useGalleryLanguage } from "@/lib/galleryLanguage";

const pollingIntervalMs = 3000;
const maximumPolls = 20;

export default function Success({ orderToken = "" }) {
  const language = useGalleryLanguage();
  const text = galleryText[language];
  const query = new URLSearchParams(window.location.search);
  const sessionId = query.get("session_id") || "";
  const token = orderToken || query.get("token") || "";
  const [downloads, setDownloads] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    applyDocumentLanguage(language);
  }, [language]);

  useEffect(() => {
    let active = true;
    let timeout;
    let polls = 0;

    const loadDownloads = async () => {
      if (!supabase) {
        setStatus("error");
        setError("Secure downloads are not configured for this gallery.");
        return;
      }
      if (Boolean(sessionId) === Boolean(token)) {
        setStatus("error");
        setError("This download link is missing a valid order reference.");
        return;
      }

      try {
        const { data, error: invokeError } = await supabase.functions.invoke("order-downloads", {
          body: sessionId ? { sessionId } : { token },
        });
        if (invokeError) throw invokeError;
        if (data?.error) throw new Error(data.error);
        if (!active) return;

        if (data?.status === "paid" && Array.isArray(data.items)) {
          setDownloads(data.items);
          setStatus("ready");
          setError("");
          if (sessionId) cacheCartSelection("public-gallery", []);
          return;
        }
        if (data?.status === "pending" && polls < maximumPolls) {
          polls += 1;
          setStatus("processing");
          timeout = window.setTimeout(loadDownloads, pollingIntervalMs);
          return;
        }
        if (data?.status === "pending") {
          setStatus("processing");
          return;
        }
        setStatus("error");
        setError(
          data?.status === "expired"
            ? "This checkout expired before payment was completed."
            : "No completed purchase was found for this link.",
        );
      } catch (loadError) {
        if (!active) return;
        setStatus("error");
        setError(await edgeFunctionErrorMessage(
          loadError,
          "Could not load your purchased photos.",
        ));
      }
    };

    setStatus("loading");
    setError("");
    loadDownloads();
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [refreshCount, sessionId, token]);

  return (
    <main className="min-h-screen bg-white px-4 py-12 text-neutral-900">
      <section className="mx-auto max-w-2xl">
        <div className="text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-black tracking-tight">
            {status === "ready" ? "Your photos are ready" : "Thank you for your order"}
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            Thank you for supporting @vaglan_clicks.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Keep this private link to return to your downloads.
          </p>
          <a href="/info" className="mt-3 inline-block text-xs font-semibold underline">
            {text.successInfo}
          </a>
        </div>

        {status === "loading" || status === "processing" ? (
          <div role="status" className="mt-10 flex items-center justify-center gap-2 text-sm text-neutral-600">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            {status === "processing"
              ? "Confirming payment securely. This can take a few moments…"
              : "Loading your downloads…"}
          </div>
        ) : null}

        {error && (
          <div className="mt-8 text-center">
            <p role="alert" className="text-sm text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => setRefreshCount((count) => count + 1)}
              className="mt-4 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold"
            >
              Try again
            </button>
          </div>
        )}

        {status === "processing" && !error && (
          <div className="mt-8 text-center">
            <p className="text-xs text-neutral-500">
              If confirmation takes longer, you can check again below.
            </p>
            <button
              type="button"
              onClick={() => setRefreshCount((count) => count + 1)}
              className="mt-4 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold"
            >
              Check again
            </button>
          </div>
        )}

        {status === "ready" && (
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {downloads.map((photo) => (
              <article key={photo.photoId} className="overflow-hidden rounded-xl border border-neutral-200">
                {photo.previewUrl ? (
                  <img
                    src={photo.previewUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="grid aspect-square place-items-center bg-neutral-100 text-xs text-neutral-500">
                    Photo
                  </div>
                )}
                <a
                  href={photo.downloadUrl}
                  download={photo.filename}
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 px-3 py-3 text-center text-xs font-bold"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download High-Res
                </a>
              </article>
            ))}
            {downloads.length === 0 && (
              <p className="col-span-full text-center text-sm text-neutral-600">
                This paid order has no downloadable photos. Please contact the photographer.
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
