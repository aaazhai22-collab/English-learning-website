/** Local image OCR. Engine, WASM and language data are served by this site. */
export const OCR_LIMITS = Object.freeze({
  maxFiles: 10,
  maxFileBytes: 12 * 1024 * 1024,
});

const vendorURL = new URL('../vendor/ocr/', import.meta.url);
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/x-ms-bmp']);
const languageCodes = new Set(['eng', 'eng+chi_sim', 'chi_sim']);
const maxPixels = 40_000_000;
const maxSide = 3000;

function ocrError(message, code) {
  return Object.assign(new Error(message), { code });
}

function abortError() {
  return new DOMException('已取消图片识别。', 'AbortError');
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

function imageName(file, index) {
  return String(file.name || `图片 ${index + 1}`).replace(/[\u0000-\u001f]/g, '').slice(0, 160);
}

function validateFiles(files, rotation) {
  const list = Array.from(files || []);
  if (!list.length) throw ocrError('请先选择要识别的图片。', 'no_images');
  if (list.length > OCR_LIMITS.maxFiles) throw ocrError('一次最多识别 10 张图片，请分批导入。', 'too_many_images');
  return list.map((input, index) => {
    const file = input instanceof Blob ? input : input?.file;
    const angle = input instanceof Blob || input?.rotation == null ? rotation : Number(input.rotation);
    const name = imageName(file || {}, index);
    const entry = { file, name, rotation: angle };
    try {
      if (!(file instanceof Blob)) throw ocrError(`${name} 不是可读取的图片文件。`, 'invalid_image');
      if (!file.size) throw ocrError(`${name} 是空文件，请重新选择。`, 'empty_image');
      if (file.size > OCR_LIMITS.maxFileBytes) throw ocrError(`${name} 超过 12 MB，请先缩小图片。`, 'image_too_large');
      const type = file.type.toLowerCase();
      if (!imageTypes.has(type) && !(type === '' && /\.(?:jpe?g|png|webp|bmp)$/i.test(file.name || ''))) {
        throw ocrError(`${name} 的格式暂不支持，请使用 JPG、PNG、WebP 或 BMP 图片。`, 'unsupported_image');
      }
      if (![0, 90, 180, 270].includes(angle)) throw ocrError(`${name} 的旋转角度必须为 0、90、180 或 270 度。`, 'invalid_rotation');
    } catch (error) {
      entry.validationError = error;
    }
    return entry;
  });
}

async function decodeImage(file, signal) {
  checkAbort(signal);
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (signal?.aborted) { bitmap.close(); throw abortError(); }
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // Older Safari versions can decode some formats only with HTMLImageElement.
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      const cancelled = () => { image.src = ''; reject(abortError()); };
      const cleanup = () => signal?.removeEventListener('abort', cancelled);
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(ocrError('无法读取这张图片，请换一张清晰的图片。', 'image_decode_failed')); };
      signal?.addEventListener('abort', cancelled, { once: true });
      image.src = url;
      if (signal?.aborted) cancelled();
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => { image.src = ''; } };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function prepareImage(file, rotation, signal) {
  const source = await decodeImage(file, signal);
  try {
    if (!source.width || !source.height || source.width * source.height > maxPixels) {
      throw ocrError('图片像素过大或尺寸无效，请先缩小到 4000 万像素以内。', 'image_dimensions');
    }
    const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const sideways = rotation === 90 || rotation === 270;
    const canvas = document.createElement('canvas');
    canvas.width = sideways ? height : width;
    canvas.height = sideways ? width : height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw ocrError('浏览器无法处理图片，请换一个现代浏览器重试。', 'canvas_unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.drawImage(source.image, -width / 2, -height / 2, width, height);
    checkAbort(signal);
    return canvas;
  } finally {
    source.close();
  }
}

/**
 * @param {Iterable<File|Blob|{file: File|Blob, rotation?:number}>} files In page order.
 * @param {{signal?: AbortSignal, onProgress?: Function, rotation?: number, language?: string}} options
 * @returns {Promise<{pages: Array<{name:string,text:string,confidence:number,width:number,height:number,rotation:number,error?:string}>,text:string}>}
 * onProgress receives {status,stage,progress,pageIndex,totalPages,name}. Progress
 * is monotonic from 0 to 1 across the whole batch; pageIndex is zero-based.
 */
export async function recognizeImages(files, { signal, onProgress, rotation = 0, language = 'eng+chi_sim' } = {}) {
  if (signal?.aborted) throw Object.assign(abortError(), { pages: [] });
  rotation = Number(rotation);
  if (![0, 90, 180, 270].includes(rotation)) throw ocrError('图片旋转角度必须为 0、90、180 或 270 度。', 'invalid_rotation');
  const list = validateFiles(files, rotation);
  if (!languageCodes.has(language)) throw ocrError('识别语言请选择英文、中英文或简体中文。', 'invalid_language');
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
    throw ocrError('当前浏览器不支持本地图片识别，请使用最新版 Edge、Chrome、Firefox 或 Safari。', 'ocr_unsupported');
  }

  let worker = null;
  let initializing = null;
  let terminated = false;
  let pageIndex = 0;
  let progress = 0;
  let abortListener;
  const pages = [];
  const terminate = async () => {
    if (worker && !terminated) { terminated = true; await worker.terminate(); }
  };
  const cancellation = new Promise((_, reject) => {
    abortListener = () => { void terminate().catch(() => {}); reject(abortError()); };
    signal?.addEventListener('abort', abortListener, { once: true });
  });
  const wait = promise => signal ? Promise.race([promise, cancellation]) : promise;
  const report = (stage, status, value) => {
    if (signal?.aborted) return;
    progress = Math.max(progress, Math.min(1, value));
    if (typeof onProgress === 'function') {
      try { onProgress({ stage, status, progress, pageIndex, totalPages: list.length, name: list[pageIndex].name }); }
      catch { /* A rendering callback must not interrupt the OCR worker. */ }
    }
  };

  try {
    report('loading', '载入本地识别引擎', 0);
    // The official v6 browser ESM bundle exposes the API as its default export.
    const { default: Tesseract } = await wait(import('../vendor/ocr/tesseract.esm.min.js'));
    checkAbort(signal);
    for (pageIndex = 0; pageIndex < list.length; pageIndex++) {
      checkAbort(signal);
      const entry = list[pageIndex];
      report('preparing', '准备图片', 0.12 + pageIndex / list.length * 0.86);
      let canvas;
      try {
        if (entry.validationError) throw entry.validationError;
        canvas = await wait(prepareImage(entry.file, entry.rotation, signal));
        if (!worker) {
          report('loading', '载入本地中英文识别数据', progress);
          initializing = Tesseract.createWorker(language, 1, {
            workerPath: new URL('worker.min.js', vendorURL).href,
            corePath: new URL('core/', vendorURL).href,
            langPath: new URL('lang/', vendorURL).href,
            workerBlobURL: false,
            legacyCore: false,
            gzip: true,
            cacheMethod: 'write',
            cachePath: 'reading-lab-ocr-v6-fast-806cd9ad',
            logger: event => {
              if (event.status === 'recognizing text') {
                report('recognizing', '正在识别文字', 0.12 + (pageIndex + Math.max(0, Math.min(1, Number(event.progress) || 0)) * 0.98) / list.length * 0.86);
              }
            },
            errorHandler: () => {},
          }).then(async instance => {
            if (signal?.aborted) { await instance.terminate(); throw abortError(); }
            worker = instance;
            return instance;
          });
          await wait(initializing);
          await wait(worker.setParameters({ preserve_interword_spaces: '1' }));
        }
        checkAbort(signal);
        report('recognizing', '正在识别文字', progress);
        const { data } = await wait(worker.recognize(canvas, { rotateAuto: false }, { text: true }));
        checkAbort(signal);
        const text = String(data.text || '').replace(/\r\n?/g, '\n').trim();
        if (!text) throw ocrError('没有识别到文字，请检查方向、清晰度或裁去大面积空白。', 'no_text_detected');
        pages.push({
          name: entry.name,
          text,
          confidence: Math.max(0, Math.min(100, Number(data.confidence) || 0)),
          width: canvas.width,
          height: canvas.height,
          rotation: entry.rotation,
        });
        report('page-complete', '本页识别完成', 0.12 + (pageIndex + 1) / list.length * 0.86);
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw abortError();
        pages.push({
          name: entry.name, text: '', confidence: 0,
          width: canvas?.width || 0, height: canvas?.height || 0,
          rotation: entry.rotation,
          error: error?.code ? error.message : '本页识别失败，请检查图片或刷新后重试。',
          code: error?.code || 'ocr_failed',
        });
        report('page-error', '本页未完成，继续识别下一页', 0.12 + (pageIndex + 1) / list.length * 0.86);
      } finally {
        if (canvas) { canvas.width = 1; canvas.height = 1; }
      }
    }
    if (!pages.some(page => page.text)) {
      throw Object.assign(ocrError('这些图片均未识别到文字，请检查图片方向和清晰度后重试。', 'no_text_detected'), { pages });
    }
    pageIndex = list.length - 1;
    report('done', '全部图片识别完成，请核对原图', 1);
    return { pages, text: pages.map(page => page.text).filter(Boolean).join('\n\n') };
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      throw Object.assign(abortError(), { pages: [...pages] });
    }
    if (error?.code) throw error;
    throw ocrError('图片识别未完成。请检查图片是否清晰，或刷新页面后重试。', 'ocr_failed');
  } finally {
    signal?.removeEventListener('abort', abortListener);
    await terminate().catch(() => {});
    // If cancellation happened while initializing, the resolution handler above
    // releases that worker as soon as the local engine finishes loading.
    initializing?.catch(() => {});
  }
}
