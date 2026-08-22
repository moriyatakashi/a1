// m4: 現在地マップ(a2からの移植、ba-?)
//
// map.jsonの座標は元のGeolonia静的SVGの作画座標(viewBox 0 0 1000 1000、
// 県ごとのtranslate/matrixを織り込み済み)であり、緯度経度ではない。現在地判定は
// 外部API(Nominatim)を使わず、transform.jsonのアフィン変換係数でGPS座標を
// このSVG座標系に直接変換し、自作のRay casting(点がポリゴン内にあるかの判定)で
// 都道府県を求める。完全ローカル処理・CDN不要。
//
// 変換係数は本州・北海道・四国・九州8県庁所在地の実緯度経度とmap.json上の
// 対応座標から最小二乗法で算出したもの(ラフな精度、詳細はtransform.json参照)。
// 沖縄・鹿児島南西諸島はこのSVGでは本来の地理的位置とは別の枠(inset)に
// 描かれているため対象外(判定されなくても正常動作)。
//
// a2版との違い: bodyを丸ごと差し替えず、index.html側の#map-rootにだけ描画する
// (a1側のページ枠・戻るリンク・見出しを維持するため)。

// 1. map.json と transform.json を読み込み
async function initializeMap() {
  const root = document.getElementById('map-root');
  try {
    const [geoData, transform] = await Promise.all([
      fetch('map.json').then(r => r.json()),
      fetch('transform.json').then(r => r.json()),
    ]);

    // SVG を静的に生成
    root.innerHTML = generateSvgFromGeoJson(geoData);

    // 現在位置で県を判定・色変更
    detectAndHighlightPrefecture(geoData, transform);

  } catch (error) {
    console.error('エラー:', error);
    root.innerHTML = '<p>地図の読み込みに失敗しました</p>';
  }
}

// 2. GeoJSON から SVG を生成
// geometryはPolygon(単一の島)とMultiPolygon(沖縄・鹿児島・東京都のような飛び地県)の
// 両方があり得る。全ての多角形をfeatureごとに1つの<g>にまとめて描く。
function generateSvgFromGeoJson(geoData) {
  let svg = `
    <svg class="geolonia-svg-map" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
      <title>Japanese Prefectures</title>
      <style>
        .prefecture { cursor: pointer; }
        .prefecture:hover { opacity: 0.8; }
        .prefecture.active polygon { fill: #FF6B6B !important; }
      </style>
  `;

  geoData.features.forEach(feature => {
    const code = feature.properties.code;
    const name = feature.properties.name;
    const geom = feature.geometry;
    const polygons = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];

    const polygonTags = polygons.map(poly => {
      // poly[0]は外周リング(元データに穴はないためholeは扱わない)
      const points = poly[0].map(c => `${c[0]},${c[1]}`).join(' ');
      return `<polygon points="${points}" fill="#EEEEEE" stroke="#000000" stroke-width="1.0" stroke-linejoin="round"/>`;
    }).join('\n        ');

    svg += `
      <g class="prefecture" data-code="${code}" data-name="${name}">
        ${polygonTags}
        <title>${name}</title>
      </g>
    `;
  });

  svg += `</svg>`;
  return svg;
}

// 3. Geolocation で現在位置を取得し、県を判定
function detectAndHighlightPrefecture(geoData, transform) {
  if (!navigator.geolocation) {
    console.log('Geolocation API は利用できません');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      console.log(`現在位置: ${lat}, ${lon}`);

      const [x, y] = gpsToSvg(lat, lon, transform);
      const feature = findPrefectureByPoint(x, y, geoData);
      if (feature) {
        console.log(`判定された県: ${feature.properties.name}`);
        highlightPrefecture(feature.properties.code);
      } else {
        console.log(`県を特定できませんでした(SVG座標: ${x.toFixed(1)}, ${y.toFixed(1)}。沖縄・離島は対象外)`);
      }
    },
    (error) => {
      console.log(`位置情報取得エラー: ${error.message}`);
    }
  );
}

// 3-a. 緯度経度 → SVG座標(transform.jsonのアフィン変換係数で変換)
function gpsToSvg(lat, lon, transform) {
  const x = transform.x.lat * lat + transform.x.lon * lon + transform.x.c;
  const y = transform.y.lat * lat + transform.y.lon * lon + transform.y.c;
  return [x, y];
}

// 3-b. 点(SVG座標)が1つのリング(頂点配列)の内側にあるか(Ray casting法)
// 水平半直線を右方向に伸ばし、ポリゴンの辺と交差する回数の偶奇で判定する定番アルゴリズム。
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = (yi > y) !== (yj > y) &&
      x < (xj - xi) * (y - yi) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// 3-c. 点がfeature(Polygon/MultiPolygon)の内側にあるか。
// MultiPolygonは飛び地の集まりなので、いずれか1つのポリゴンに入っていればOK。
function pointInFeature(x, y, geometry) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polygons.some(poly => pointInRing(x, y, poly[0])); // poly[0]=外周リング(穴なしデータ)
}

// 4. SVG座標からfeatureを特定
function findPrefectureByPoint(x, y, geoData) {
  return geoData.features.find(f => pointInFeature(x, y, f.geometry)) || null;
}

// 5. 県をハイライト
function highlightPrefecture(code) {
  const prefElement = document.querySelector(`[data-code="${code}"]`);
  if (prefElement) {
    prefElement.classList.add('active');
  }
}

// ページロード時に実行
window.addEventListener('DOMContentLoaded', initializeMap);
