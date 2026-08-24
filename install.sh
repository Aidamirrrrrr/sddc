#!/bin/sh
set -eu

REPOSITORY="Aidamirrrrrr/sddc"
INSTALL_DIR="${SDDC_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) platform="macos" ;;
  Linux) platform="linux" ;;
  *) echo "sddc supports macOS and Linux through this installer." >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64|aarch64) architecture="arm64" ;;
  x86_64|amd64) architecture="x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

asset="sddc-${platform}-${architecture}"
base_url="https://github.com/${REPOSITORY}/releases/latest/download"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT INT TERM

echo "Downloading ${asset}..."
curl --fail --location --silent --show-error "${base_url}/${asset}" --output "${temporary}/${asset}"
curl --fail --location --silent --show-error "${base_url}/checksums.txt" --output "${temporary}/checksums.txt"

expected="$(awk -v name="$asset" '$2 == name || $2 == "artifacts/" name { print $1 }' "${temporary}/checksums.txt")"
if [ -z "$expected" ]; then
  echo "Checksum for ${asset} is missing." >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${temporary}/${asset}" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "${temporary}/${asset}" | awk '{print $1}')"
fi
if [ "$actual" != "$expected" ]; then
  echo "Checksum verification failed." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
install -m 755 "${temporary}/${asset}" "${INSTALL_DIR}/sddc"
"${INSTALL_DIR}/sddc" --init

echo "Installed sddc to ${INSTALL_DIR}/sddc"
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *) echo "Add ${INSTALL_DIR} to PATH, then run: sddc --help" ;;
esac
