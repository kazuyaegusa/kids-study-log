export async function shrinkImage(file, maxSide = 1280) {
  if (!file.type.startsWith('image/')) throw new Error('画像を選んでください');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像を読み込めません')), 'image/jpeg', 0.8));
  } finally { URL.revokeObjectURL(url); }
}

export function objectURL(blob, urls) {
  const url = URL.createObjectURL(blob);
  urls.push(url);
  return url;
}
