const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const plugin = require('../plugins/with-full-resolution-fresco.js');
const { addFullResolutionFresco, MAX_BITMAP_DIMENSION } = plugin;

// Expo SDK 57 template MainApplication.kt (node_modules/expo/template.tgz) after Viro's plugin.
const TEMPLATE = `package com.djleg.medicalviewer
import com.viromedia.bridge.ReactViroPackage

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
            add(ReactViroPackage(ReactViroPackage.ViroPlatform.QUEST))

        }
    )
  }
}
`;

test('every bundled volume atlas fits under the configured Fresco limit', () => {
  const dir = path.join(__dirname, '../assets/medical/volumes');
  const atlases = fs.readdirSync(dir).filter((name) => name.endsWith('.png'));
  assert.equal(atlases.length, 6);
  for (const name of atlases) {
    // PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20.
    const header = fs.readFileSync(path.join(dir, name)).subarray(0, 24);
    const size = [header.readUInt32BE(16), header.readUInt32BE(20)];
    assert.ok(Math.max(...size) > 2048, `${name} needs more than Fresco's default 2048`);
    assert.ok(Math.max(...size) <= MAX_BITMAP_DIMENSION, `${name} ${size.join('x')}`);
  }
});

test('prebuild output passes the full-resolution Fresco config to PackageList', () => {
  const result = addFullResolutionFresco(TEMPLATE);
  assert.match(result, /private fun createMainPackageConfig\(\)/);
  assert.match(result, /setMaxBitmapDimension\(2112\)/);
  assert.match(
    result,
    /setDownsampleMode\(com\.facebook\.imagepipeline\.core\.DownsampleMode\.AUTO\)/
  );
  assert.match(result, /setBinaryXmlEnabled\(true\)/);
  assert.match(result, /container\?\.setCookieJar\(okhttp3\.JavaNetCookieJar\(handler\)\)/);
  assert.match(result, /PackageList\(this, createMainPackageConfig\(\)\)\.packages\.apply \{/);
  // Viro's manual package registration is untouched.
  assert.match(result, /add\(ReactViroPackage\(ReactViroPackage\.ViroPlatform\.QUEST\)\)/);
  assert.equal(result.match(/createMainPackageConfig\(\)/g).length, 2);
});

test('running the plugin twice changes nothing', () => {
  const once = addFullResolutionFresco(TEMPLATE);
  assert.equal(addFullResolutionFresco(once), once);
});

test('an older generated limit is updated in place', () => {
  const stale = addFullResolutionFresco(TEMPLATE).replace(
    'setMaxBitmapDimension(2112)',
    'setMaxBitmapDimension(2048)'
  );
  const result = addFullResolutionFresco(stale);
  assert.match(result, /setMaxBitmapDimension\(2112\)/);
  assert.equal(result.match(/fun createMainPackageConfig/g).length, 1);
});

test('an unrecognised MainApplication fails prebuild instead of silently halving atlases', () => {
  assert.throws(
    () => addFullResolutionFresco(TEMPLATE.replace('PackageList(this).packages', 'packages')),
    /PackageList\(this\)\.packages not found/
  );
  assert.throws(
    () => addFullResolutionFresco('object Nothing {}\n'),
    /class declaration not found/
  );
});

test('app.json registers the plugin after Viro', () => {
  const { expo } = require('../app.json');
  const names = expo.plugins.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
  assert.ok(names.includes('./plugins/with-full-resolution-fresco'));
  assert.ok(
    names.indexOf('./plugins/with-full-resolution-fresco') >
      names.indexOf('@reactvision/react-viro')
  );
});

test('the plugin keeps an existing generated android/ MainApplication unchanged', (t) => {
  const file = path.join(
    __dirname,
    '../android/app/src/main/java/com/djleg/medicalviewer/MainApplication.kt'
  );
  if (!fs.existsSync(file)) return t.skip('android/ has not been generated');
  const contents = fs.readFileSync(file, 'utf8');
  if (!contents.includes('createMainPackageConfig')) return t.skip('generated before the plugin');
  assert.equal(addFullResolutionFresco(contents), contents);
});
