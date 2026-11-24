package io.github.pimentelcode.gasolina;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GasolinaPlugin.class);   // instalar a versão nova do app
        super.onCreate(savedInstanceState);
    }
}
