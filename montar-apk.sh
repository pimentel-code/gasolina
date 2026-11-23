#!/usr/bin/env bash
# Monta o APK do Gasolina para Android.
#   ./montar-apk.sh       → gera Gasolina.apk nesta pasta
# Precisa: Java 21 (pacman jdk21-openjdk) e o kit Android em ~/Android/Sdk (os mesmos do Prumo).
set -euo pipefail
cd "$(dirname "$0")"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk}"

./copiar-www.sh
npx cap sync android >/dev/null
(cd android && ./gradlew --quiet assembleDebug)
cp android/app/build/outputs/apk/debug/app-debug.apk Gasolina.apk
echo
echo "Pronto: $(pwd)/Gasolina.apk ($(du -h Gasolina.apk | cut -f1))"
