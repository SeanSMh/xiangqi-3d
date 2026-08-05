#!/bin/sh

set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
character_source="$project_root/resources/art/production/redesign"
silhouette_source="$project_root/resources/art/production/silhouettes"
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

for size in 512 768; do
  character_output="$stage_root/$size/characters"
  silhouette_output="$stage_root/$size/silhouettes"
  mkdir -p "$character_output" "$silhouette_output"

  for source in "$character_source"/red_*_v3.jpg "$character_source"/black_*_v3.jpg; do
    filename=${source##*/}
    /usr/bin/sips --resampleHeightWidthMax "$size" "$source" \
      --out "$character_output/$filename" >/dev/null
  done

  for source in "$silhouette_source"/sil_*_alpha.png; do
    filename=${source##*/}
    /usr/bin/sips --resampleHeightWidthMax "$size" "$source" \
      --out "$silhouette_output/$filename" >/dev/null
  done

  character_count=$(find "$character_output" -type f -name '*.jpg' | wc -l | tr -d '[:space:]')
  silhouette_count=$(find "$silhouette_output" -type f -name '*.png' | wc -l | tr -d '[:space:]')
  if [ "$character_count" -ne 14 ] || [ "$silhouette_count" -ne 7 ]; then
    echo "Unexpected asset count for tier $size: $character_count colors, $silhouette_count masks" >&2
    exit 1
  fi

  for kind in advisor cannon chariot elephant horse king pawn; do
    mask="$silhouette_output/sil_${kind}_alpha.png"
    mask_dimensions=$(image_dimensions "$mask")
    mask_has_alpha=$(/usr/bin/sips -g hasAlpha "$mask" 2>/dev/null | awk '/hasAlpha/ { print $2 }')
    if [ "$mask_has_alpha" != 'yes' ]; then
      echo "Missing alpha channel: $mask" >&2
      exit 1
    fi
    for side in red black; do
      color="$character_output/${side}_${kind}_v3.jpg"
      color_dimensions=$(image_dimensions "$color")
      if [ "$color_dimensions" != "$mask_dimensions" ]; then
        echo "Color/mask size mismatch: $color ($color_dimensions), $mask ($mask_dimensions)" >&2
        exit 1
      fi
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

echo "Generated and verified paired 512/768 character and silhouette runtime assets."
