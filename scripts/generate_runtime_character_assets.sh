#!/bin/sh

set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
character_source="$project_root/resources/art/production/redesign"
silhouette_source="$project_root/resources/art/production/silhouettes"
# 站立态背视的缩放源必须取**处理后**的运行时源尺寸副本，不能取 resources。
# resources/art/production/back_idle/ 存的是交付的洋红底原画，抠图与蒙版由
# scripts/prepare_back_view.mjs 离线完成，产物只落在 public/assets/ 下；
# 从 resources 缩放会把洋红背景一起烤进移动端贴图。
back_character_source="$project_root/public/assets/characters"
back_silhouette_source="$project_root/public/assets/silhouettes"
runtime_output="$project_root/public/assets/runtime"
stage_root=$(mktemp -d "$project_root/.runtime-character-assets.XXXXXX")
installation_phase='staging'

cleanup_generation() {
  if [ "$installation_phase" != 'staging' ]; then
    for cleanup_size in 512 768; do
      for cleanup_category in characters silhouettes; do
        cleanup_destination="$runtime_output/$cleanup_size/$cleanup_category"
        cleanup_backup="${cleanup_destination}.previous.$$"
        if [ "$installation_phase" = 'committed' ]; then
          rm -rf "$cleanup_backup"
        elif [ -e "$cleanup_backup" ]; then
          rm -rf "$cleanup_destination"
          mv "$cleanup_backup" "$cleanup_destination"
        elif [ "$installation_phase" = 'installing' ]; then
          # 已进入安装期却没有备份，说明该目录原本不存在；恢复为不存在。
          rm -rf "$cleanup_destination"
        fi
      done
    done
  fi
  installation_phase='staging'
  rm -rf "$stage_root"
}

abort_generation() {
  cleanup_generation
  exit 1
}

trap cleanup_generation EXIT
trap abort_generation HUP INT TERM

image_dimensions() {
  /usr/bin/sips -g pixelWidth -g pixelHeight "$1" 2>/dev/null |
    awk '/pixelWidth/ { width = $2 } /pixelHeight/ { print width "x" $2 }'
}

resample_into() {
  resample_destination=$1
  shift
  for resample_source in "$@"; do
    if [ ! -f "$resample_source" ]; then
      echo "Missing source asset: $resample_source" >&2
      exit 1
    fi
    /usr/bin/sips --resampleHeightWidthMax "$resample_size" "$resample_source" \
      --out "$resample_destination/${resample_source##*/}" >/dev/null
  done
}

# 蒙版必须带 Alpha：运行时靠 texture.a 裁轮廓，丢了通道会整块方图糊上去。
assert_mask_alpha() {
  if [ "$(/usr/bin/sips -g hasAlpha "$1" 2>/dev/null | awk '/hasAlpha/ { print $2 }')" != 'yes' ]; then
    echo "Missing alpha channel: $1" >&2
    exit 1
  fi
}

# 彩图与蒙版共用同一套 UV，尺寸不一致会让角色错位。
assert_paired_size() {
  assert_color_dimensions=$(image_dimensions "$1")
  assert_mask_dimensions=$(image_dimensions "$2")
  if [ "$assert_color_dimensions" != "$assert_mask_dimensions" ]; then
    echo "Color/mask size mismatch: $1 ($assert_color_dimensions), $2 ($assert_mask_dimensions)" >&2
    exit 1
  fi
}

for size in 512 768; do
  resample_size=$size
  character_output="$stage_root/$size/characters"
  silhouette_output="$stage_root/$size/silhouettes"
  mkdir -p "$character_output" "$silhouette_output"

  resample_into "$character_output" \
    "$character_source"/red_*_v3.jpg \
    "$character_source"/black_*_v3.jpg \
    "$back_character_source"/red_*_back_v3.jpg \
    "$back_character_source"/black_*_back_v3.jpg

  resample_into "$silhouette_output" \
    "$silhouette_source"/sil_*_alpha.png \
    "$back_silhouette_source"/sil_*_back_alpha.png

  character_count=$(find "$character_output" -type f -name '*.jpg' | wc -l | tr -d '[:space:]')
  silhouette_count=$(find "$silhouette_output" -type f -name '*.png' | wc -l | tr -d '[:space:]')
  # 14 正面彩图 + 14 背视彩图；7 张红黑共用的正面蒙版 + 14 张逐阵营背视蒙版。
  if [ "$character_count" -ne 28 ] || [ "$silhouette_count" -ne 21 ]; then
    echo "Unexpected asset count for tier $size: $character_count colors, $silhouette_count masks" >&2
    exit 1
  fi

  for kind in advisor cannon chariot elephant horse king pawn; do
    front_mask="$silhouette_output/sil_${kind}_alpha.png"
    assert_mask_alpha "$front_mask"
    for side in red black; do
      # 正面：红黑同造型，共用一张蒙版。
      assert_paired_size "$character_output/${side}_${kind}_v3.jpg" "$front_mask"
      # 背视：蒙版逐阵营各一张，因此要按阵营配对校验。
      back_mask="$silhouette_output/sil_${side}_${kind}_back_alpha.png"
      assert_mask_alpha "$back_mask"
      assert_paired_size "$character_output/${side}_${kind}_back_v3.jpg" "$back_mask"
    done
  done
done

mkdir -p "$runtime_output"
for size in 512 768; do
  mkdir -p "$runtime_output/$size"
  for category in characters silhouettes; do
    destination="$runtime_output/$size/$category"
    backup="${destination}.previous.$$"
    if [ -e "$backup" ]; then
      echo "Refusing to overwrite unexpected backup: $backup" >&2
      exit 1
    fi
  done
done

installation_phase='backing-up'
for size in 512 768; do
  for category in characters silhouettes; do
    destination="$runtime_output/$size/$category"
    backup="${destination}.previous.$$"
    if [ -e "$destination" ]; then
      mv "$destination" "$backup"
    fi
  done
done

installation_phase='installing'
for size in 512 768; do
  for category in characters silhouettes; do
    mv \
      "$stage_root/$size/$category" \
      "$runtime_output/$size/$category"
  done
done
installation_phase='committed'

echo "Generated and verified paired 512/768 front and back character/silhouette runtime assets."
