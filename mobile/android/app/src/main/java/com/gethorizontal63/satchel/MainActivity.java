package com.gethorizontal63.satchel;

import android.graphics.Rect;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Selecting text in a book shows Satchel's own popover (highlight colours, note, copy, Define).
     * Android would put its Copy / Share / Select all toolbar on top of it, so the toolbar is given an
     * empty menu, which keeps it hidden. The selection itself and its drag handles still work.
     */
    @Override
    public ActionMode onWindowStartingActionMode(ActionMode.Callback callback, int type) {
        if (type != ActionMode.TYPE_FLOATING) return super.onWindowStartingActionMode(callback, type);
        return super.onWindowStartingActionMode(new ActionMode.Callback2() {
            @Override
            public boolean onCreateActionMode(ActionMode mode, Menu menu) {
                boolean ok = callback.onCreateActionMode(mode, menu);
                menu.clear();
                return ok;
            }

            @Override
            public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
                callback.onPrepareActionMode(mode, menu);
                menu.clear();
                return true;
            }

            @Override
            public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
                return callback.onActionItemClicked(mode, item);
            }

            @Override
            public void onDestroyActionMode(ActionMode mode) {
                callback.onDestroyActionMode(mode);
            }

            @Override
            public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
                if (callback instanceof ActionMode.Callback2) ((ActionMode.Callback2) callback).onGetContentRect(mode, view, outRect);
                else super.onGetContentRect(mode, view, outRect);
            }
        }, type);
    }
}
