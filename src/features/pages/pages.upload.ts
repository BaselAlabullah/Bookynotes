export function uploadFileToSignedUrl({
  url,
  file,
  onProgress,
}: {
  url: string;
  file: File;
  onProgress: (progress: number) => void;
}) {
  return new Promise<{ status: number }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const uploadBody = new FormData();

    uploadBody.append("cacheControl", "3600");
    uploadBody.append("", file);

    request.open("PUT", url);
    request.setRequestHeader("x-upsert", "false");

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total === 0) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    request.onerror = () => reject(new Error("Upload failed before it reached storage."));
    request.onabort = () => reject(new Error("Upload was cancelled."));
    request.onload = () => resolve({ status: request.status });
    request.send(uploadBody);
  });
}
