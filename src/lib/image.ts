// ضغط الصور من جهة العميل قبل الرفع (افتراضيًا WebP 800px للمنتجات)
export const compressImage = (
  file: File,
  options?: { maxWidth?: number; quality?: number; type?: "image/webp" | "image/jpeg" | "image/png" }
): Promise<File> => {
  const { maxWidth = 800, quality = 0.82, type } = options || {};
  const requestedType = type || file.type;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        const finish = (blob: Blob | null, finalType: string) => {
          if (!blob) return reject(new Error("فشل في ضغط الصورة"));
          const outType = blob.type || finalType;
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, "") + (outType === "image/webp" ? ".webp" : file.name.match(/\.[^.]+$/)?.[0] || ".jpg"), {
            type: outType,
            lastModified: Date.now(),
          });
          resolve(compressed);
        };
        if (requestedType === "image/webp") {
          canvas.toBlob((blob) => {
            if (blob && blob.type === "image/webp") finish(blob, "image/webp");
            else canvas.toBlob((jpeg) => finish(jpeg, "image/jpeg"), "image/jpeg", quality);
          }, "image/webp", quality);
        } else {
          canvas.toBlob((blob) => finish(blob, requestedType), requestedType, quality);
        }
      };
      img.onerror = () => reject(new Error("فشل في تحميل الصورة"));
    };
    reader.onerror = () => reject(new Error("فشل في تحميل الصورة"));
  });
};
