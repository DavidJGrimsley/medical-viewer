const { withMainApplication } = require('expo/config-plugins');

/**
 * The 3D Scan atlases are 2106x1944. Fresco's default max bitmap dimension (2048) makes it decode
 * them at half resolution, which Viro then uploads, so the shader samples the wrong texels. This
 * gives React Native's Fresco pipeline a slightly larger limit; everything else matches RN's
 * default builder except its internal header-aware fetcher and Systrace listener, which only
 * matter for remote images with `headers`/`cache` (this app bundles all of its images).
 */
const MAX_BITMAP_DIMENSION = 2112;

const CONFIG_FUNCTION = `  private fun createMainPackageConfig(): com.facebook.react.shell.MainPackageConfig {
    val client = com.facebook.react.modules.network.OkHttpClientProvider.createClient()
    val container = client.cookieJar as? com.facebook.react.modules.network.CookieJarContainer
    val handler = com.facebook.react.modules.network.ForwardingCookieHandler()
    container?.setCookieJar(okhttp3.JavaNetCookieJar(handler))
    val builder = com.facebook.imagepipeline.backends.okhttp3.OkHttpImagePipelineConfigFactory
      .newBuilder(applicationContext, client)
      .setDownsampleMode(com.facebook.imagepipeline.core.DownsampleMode.AUTO)
    builder.experiment().setBinaryXmlEnabled(true)
    builder.experiment().setMaxBitmapDimension(${MAX_BITMAP_DIMENSION})
    return com.facebook.react.shell.MainPackageConfig(builder.build())
  }
`;

function addFullResolutionFresco(contents) {
  let result = contents;
  if (/fun createMainPackageConfig\(\)/.test(result)) {
    result = result.replace(
      /setMaxBitmapDimension\(\d+\)/,
      `setMaxBitmapDimension(${MAX_BITMAP_DIMENSION})`
    );
  } else {
    const classLine = /class MainApplication\s*:\s*Application\(\),\s*ReactApplication\s*\{\n/;
    if (!classLine.test(result))
      throw new Error('with-full-resolution-fresco: MainApplication class declaration not found.');
    result = result.replace(classLine, (line) => `${line}\n${CONFIG_FUNCTION}`);
  }
  if (!result.includes('PackageList(this, createMainPackageConfig())')) {
    if (!result.includes('PackageList(this).packages'))
      throw new Error('with-full-resolution-fresco: PackageList(this).packages not found.');
    result = result.replace(
      'PackageList(this).packages',
      'PackageList(this, createMainPackageConfig()).packages'
    );
  }
  return result;
}

function withFullResolutionFresco(config) {
  return withMainApplication(config, (mod) => {
    if (mod.modResults.language !== 'kt')
      throw new Error('with-full-resolution-fresco: only a Kotlin MainApplication is supported.');
    mod.modResults.contents = addFullResolutionFresco(mod.modResults.contents);
    return mod;
  });
}

module.exports = withFullResolutionFresco;
module.exports.addFullResolutionFresco = addFullResolutionFresco;
module.exports.MAX_BITMAP_DIMENSION = MAX_BITMAP_DIMENSION;
