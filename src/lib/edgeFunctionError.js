export const edgeFunctionErrorMessage = async (error, fallback) => {
  const response = error?.context;
  if (
    typeof Response !== "undefined" &&
    response instanceof Response &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    try {
      const payload = await response.clone().json();
      if (typeof payload?.error === "string") return payload.error;
    } catch {
      return error?.message || fallback;
    }
  }
  return error?.message || fallback;
};
