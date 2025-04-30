import type { Core } from '@strapi/strapi';
import { Context, Next } from 'koa';
import sharp, { WebpOptions } from 'sharp';
import { promises as fs } from 'fs';
import { parse, join, dirname } from 'path';
import { Files, File } from 'formidable';

const DEFAULT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];
let autoOrientation = false;

export default ({ config }, { strapi }: { strapi: Core.Service }) => {
  const IMAGE_TYPES = config('mimeTypes', DEFAULT_IMAGE_TYPES);
  const SHARP_OPTIONS = config('options');

  return async (ctx: Context, next: Next) => {
    const isUpload =
      ctx.url === '/upload' &&
      ctx.method === 'POST' &&
      ctx.request.files &&
      ctx.request.body &&
      ctx.request.body.fileInfo;

    if (isUpload) {
      const pluginStore = strapi.store({
        environment: strapi.config.environment,
        type: 'plugin',
        name: 'upload',
      });
      const settings = (await pluginStore.get({ key: 'settings' })) || {};
      autoOrientation = settings.autoOrientation === true;

      const files = ctx.request.files as Files;

      for (const key in files) {
        const fileOrFiles = files[key];

        if (Array.isArray(fileOrFiles)) {
          for (const file of fileOrFiles) {
            await processFile(file, ctx, IMAGE_TYPES, SHARP_OPTIONS, strapi);
          }
        } else {
          const file = fileOrFiles as File;
          await processFile(file, ctx, IMAGE_TYPES, SHARP_OPTIONS, strapi);
        }
      }
    }

    await next();
  };
};

const processFile = async (
  file: File,
  ctx: Context,
  IMAGE_TYPES: string[],
  SHARP_OPTIONS: WebpOptions,
  strapi: Core.Service
) => {
  const filePath = file.filepath;

  if (IMAGE_TYPES.includes(file.mimetype)) {
    const webpFileName = `${parse(file.originalFilename).name}.webp`;
    const webpFilePath = join(dirname(filePath), webpFileName);
    const fileInfo = JSON.parse(ctx.request.body.fileInfo);
    fileInfo.name = webpFileName;
    ctx.request.body.fileInfo = JSON.stringify(fileInfo);

    try {
      let pipeline = sharp(filePath);

      if (autoOrientation) pipeline = pipeline.rotate();
      
      pipeline = pipeline.webp(SHARP_OPTIONS);
      const sharpResult = await pipeline.toFile(webpFilePath);
      await fs.unlink(filePath);

      file.size = sharpResult.size;
      file.filepath = webpFilePath;
      file.originalFilename = webpFileName;
      file.mimetype = 'image/webp';
    } catch (error) {
      strapi.log.error(
        `Plugin (strapi-plugin-webp-converter): Image Converter Middleware: Error converting ${file.originalFilename} to webp:`,
        error
      );
    }
  } else {
    strapi.log.info(
      `Plugin (strapi-plugin-webp-converter): Image Converter Middleware: No convertable image ${file.originalFilename}`
    );
  }
};
