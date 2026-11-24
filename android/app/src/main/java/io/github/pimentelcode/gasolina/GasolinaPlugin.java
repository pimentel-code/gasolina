package io.github.pimentelcode.gasolina;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Instalar a versão nova do próprio app (o mesmo jeito do Prumo). */
@CapacitorPlugin(name = "Gasolina")
public class GasolinaPlugin extends Plugin {

    /** O Android só deixa um app instalar a versão nova dele mesmo depois que a
     *  pessoa liga "Permitir desta fonte" uma vez. */
    @PluginMethod
    public void podeInstalar(PluginCall call) {
        JSObject r = new JSObject();
        r.put("pode", Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(r);
    }

    @PluginMethod
    public void abrirPermissaoInstalar(PluginCall call) {
        Intent i = Build.VERSION.SDK_INT >= 26
            ? new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))
            : new Intent(Settings.ACTION_SECURITY_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(i); } catch (Exception e) { /* tela inexistente */ }
        call.resolve();
    }

    /** Baixa o APK (só do repositório do Gasolina) e abre o instalador do Android.
     *  O Android confere a assinatura: só aceita APK assinado com a mesma chave. */
    @PluginMethod
    public void instalarAtualizacao(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://github.com/pimentel-code/gasolina/releases/download/")) {
            call.reject("Endereço de atualização estranho; nada foi baixado.", "URL");
            return;
        }
        new Thread(() -> {
            File destino = new File(getContext().getCacheDir(), "gasolina-atualizacao.apk");
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(60000);
                if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(destino)) {
                    byte[] buf = new byte[64 * 1024];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", destino);
                Intent i = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject("Não consegui baixar a versão nova. Confira a internet e tente de novo.", "DOWNLOAD");
            }
        }).start();
    }
}
