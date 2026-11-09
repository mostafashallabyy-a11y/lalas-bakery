// ضغط صورتين 증명 الدفع من جهة العميل قبل الرفع
export const compressImage = (
  file: File,
  options?: { maxWidth?: number; quality?: number }
): Promise<File> => {
  const { maxWidth = 1000, quality = 0.8 } = options || {};
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
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("فشل في ضغط الصورة"));
            const compressed = new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now(),
            });
            resolve(compressed);
          },
          file.type,
          quality
        );
      };
      img.onerror = () => reject(new Error("فشل في تحميل الصورة"));
    };
  });
};
