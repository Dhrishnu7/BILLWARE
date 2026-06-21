/**
 * thermal-print.js — Billware Silent Thermal Printer Module
 * ----------------------------------------------------------
 * Uses the WebUSB API to send ESC/POS commands directly to a
 * USB thermal printer, bypassing the browser print dialog.
 *
 * Supported: Chrome, Edge, Opera (any Chromium-based browser)
 * Fallback:  window.print() for non-supported browsers
 *
 * Usage:
 *   ThermalPrinter.connect()         → pair a printer (one-time)
 *   ThermalPrinter.print(bill, shop) → silently print a receipt
 *   ThermalPrinter.isConnected()     → true/false
 *   ThermalPrinter.disconnect()      → unpair
 */

const ThermalPrinter = (() => {
    'use strict';

    // ── State ──────────────────────────────────────────────
    let _device = null;
    let _iface  = null;
    let _ep     = null; // OUT endpoint

    // ── ESC/POS Command Bytes ──────────────────────────────
    const ESC = 0x1B;
    const GS  = 0x1D;
    const cmd = {
        INIT:          [ESC, 0x40],              // Initialize printer
        ALIGN_LEFT:    [ESC, 0x61, 0x00],        // Left align
        ALIGN_CENTER:  [ESC, 0x61, 0x01],        // Center align
        ALIGN_RIGHT:   [ESC, 0x61, 0x02],        // Right align
        BOLD_ON:       [ESC, 0x45, 0x01],        // Bold on
        BOLD_OFF:      [ESC, 0x45, 0x00],        // Bold off
        DOUBLE_HEIGHT: [ESC, 0x21, 0x10],        // Double height text
        NORMAL_SIZE:   [ESC, 0x21, 0x00],        // Normal text size
        LF:            [0x0A],                   // Line feed
        CUT:           [GS,  0x56, 0x42, 0x00], // Full cut
        DRAWER:        [ESC, 0x70, 0x00, 0x19, 0xFA], // Open cash drawer
    };

    // ── WebUSB Support Check ───────────────────────────────
    function isSupported() {
        return !!(navigator.usb);
    }

    // ── Connect Printer (one-time user gesture required) ───
    async function connect() {
        if (!isSupported()) {
            alert('⚠️ Silent printing requires Google Chrome or Microsoft Edge.\n\nYour current browser does not support WebUSB.\nPlease switch to Chrome for this feature.');
            return false;
        }
        try {
            // Request USB device — show picker for ALL devices
            // (Most thermal printers use vendor IDs: Epson=0x04b8, Xprinter=0x0483, etc.)
            _device = await navigator.usb.requestDevice({ filters: [] });
            await _openDevice();
            console.log('[ThermalPrinter] Connected:', _device.productName);
            _saveDeviceInfo();
            return true;
        } catch (e) {
            if (e.name !== 'NotFoundError') {
                console.error('[ThermalPrinter] Connect failed:', e);
                alert('Could not connect to printer.\n\nError: ' + e.message);
            }
            return false;
        }
    }

    async function _openDevice() {
        await _device.open();
        if (_device.configuration === null) {
            await _device.selectConfiguration(1);
        }
        // Find the first bulk OUT endpoint
        for (const iface of _device.configuration.interfaces) {
            for (const alt of iface.alternates) {
                for (const ep of alt.endpoints) {
                    if (ep.direction === 'out' && ep.type === 'bulk') {
                        await _device.claimInterface(iface.interfaceNumber);
                        _iface = iface;
                        _ep    = ep;
                        return;
                    }
                }
            }
        }
        throw new Error('No bulk OUT endpoint found on this USB device. Is it a thermal printer?');
    }

    // ── Save/restore device info across page reloads ───────
    function _saveDeviceInfo() {
        if (_device) {
            localStorage.setItem('mm_thermal_printer', JSON.stringify({
                vendorId:  _device.vendorId,
                productId: _device.productId,
                name:      _device.productName || 'USB Thermal Printer',
            }));
        }
    }

    function getSavedPrinterName() {
        try {
            const info = JSON.parse(localStorage.getItem('mm_thermal_printer') || 'null');
            return info ? info.name : null;
        } catch { return null; }
    }

    // Try to auto-reconnect to a previously paired printer
    async function autoReconnect() {
        if (!isSupported()) return false;
        try {
            const devices = await navigator.usb.getDevices();
            if (devices.length > 0) {
                _device = devices[0];
                await _openDevice();
                console.log('[ThermalPrinter] Auto-reconnected:', _device.productName);
                return true;
            }
        } catch (e) {
            console.warn('[ThermalPrinter] Auto-reconnect failed:', e.message);
            _device = null; _iface = null; _ep = null;
        }
        return false;
    }

    function disconnect() {
        if (_device) {
            try { _device.releaseInterface(_iface?.interfaceNumber); } catch {}
            try { _device.close(); } catch {}
        }
        _device = null; _iface = null; _ep = null;
        localStorage.removeItem('mm_thermal_printer');
    }

    function isConnected() {
        return !!(_device && _ep);
    }

    // ── Send raw bytes to printer ──────────────────────────
    async function _send(bytes) {
        if (!isConnected()) throw new Error('Printer not connected.');
        const data = new Uint8Array(bytes);
        await _device.transferOut(_ep.endpointNumber, data);
    }

    // ── Encode text string to bytes ────────────────────────
    function _textBytes(str) {
        // Replace common Unicode with ASCII for thermal printers
        const clean = (str || '')
            .replace(/₹/g, 'Rs.')
            .replace(/[^\x00-\x7F]/g, '?');
        return Array.from(new TextEncoder().encode(clean));
    }

    // ── Pad/truncate string to fixed width ─────────────────
    function _pad(str, width, align = 'left') {
        const s = String(str || '').substring(0, width);
        if (align === 'right') return s.padStart(width, ' ');
        if (align === 'center') {
            const total = width - s.length;
            const left  = Math.floor(total / 2);
            const right = total - left;
            return ' '.repeat(left) + s + ' '.repeat(right);
        }
        return s.padEnd(width, ' ');
    }

    // Width: 48 chars for 80mm paper, 32 chars for 58mm paper
    const WIDTH = 48;
    const DIV   = '-'.repeat(WIDTH);

    // ── Format & Print Bill ────────────────────────────────
    async function print(bill, shopProfile) {
        if (!isConnected()) {
            console.warn('[ThermalPrinter] Not connected, falling back to browser print.');
            return false;
        }

        const shop = shopProfile || window.mmShopProfile || {};
        const shopName    = shop.shop_name    || 'MM Pakkam';
        const shopPhone   = shop.phone        || '';
        const shopAddr1   = shop.address_line1 || '';
        const shopAddr2   = shop.address_line2 || '';
        const shopGstin   = shop.gstin        || '';
        const shopDlNo    = shop.dl_no        || '';
        const footerMsg   = shop.footer_msg   || 'Thank you! Come again.';

        try {
            const bytes = [];
            const add = (...chunks) => chunks.forEach(c => bytes.push(...c));
            const text = (str) => _textBytes(str);
            const lf   = () => add(cmd.LF);

            // ── Initialize ──
            add(cmd.INIT);

            // ── Shop Header ──
            add(cmd.ALIGN_CENTER, cmd.BOLD_ON, cmd.DOUBLE_HEIGHT);
            add(text(shopName)); lf();
            add(cmd.NORMAL_SIZE, cmd.BOLD_OFF);

            if (shopAddr1) { add(text(shopAddr1)); lf(); }
            if (shopAddr2) { add(text(shopAddr2)); lf(); }
            if (shopPhone) { add(text('Ph: ' + shopPhone)); lf(); }
            if (shopGstin) { add(text('GSTIN: ' + shopGstin)); lf(); }
            if (shopDlNo)  { add(text('DL No: ' + shopDlNo)); lf(); }

            // ── Divider ──
            add(cmd.ALIGN_LEFT);
            add(text(DIV)); lf();

            // ── Bill Info ──
            add(cmd.BOLD_ON);
            add(text(_pad('Bill No: ' + (bill.billNo || ''), WIDTH / 2) + _pad('Date: ' + (bill.date || ''), WIDTH / 2, 'right'))); lf();
            add(cmd.BOLD_OFF);

            if (bill.customerName) {
                add(text('Customer: ' + bill.customerName)); lf();
            }
            if (bill.doctorName) {
                add(text('Doctor  : ' + bill.doctorName)); lf();
            }

            // ── Divider ──
            add(text(DIV)); lf();

            // ── Column Headers ──
            add(cmd.BOLD_ON);
            const hdr = _pad('Item', 24) + _pad('Qty', 5, 'right') + _pad('MRP', 8, 'right') + _pad('Total', 9, 'right');
            add(text(hdr)); lf();
            add(cmd.BOLD_OFF);
            add(text(DIV)); lf();

            // ── Medicine Rows ──
            let grandTotal = 0;
            (bill.medicines || []).forEach((m, i) => {
                const name  = (m.product || '').substring(0, 24);
                const qty   = String(m.qty   || 0);
                const mrp   = parseFloat(m.mrp   || 0).toFixed(2);
                const total = parseFloat(m.total || 0).toFixed(2);
                grandTotal += parseFloat(m.total || 0);

                // First line: name + values
                const line1 = _pad(name, 24) + _pad(qty, 5, 'right') + _pad(mrp, 8, 'right') + _pad(total, 9, 'right');
                add(text(line1)); lf();

                // Second line: batch + expiry (smaller info)
                if (m.batch || m.exp) {
                    const batchLine = '  Batch: ' + (m.batch || '-') + '  Exp: ' + (m.exp || '-');
                    add(text(batchLine)); lf();
                }

                // Discount line if applicable
                if (parseFloat(m.discount) > 0) {
                    add(text('  Discount: ' + m.discount + '%')); lf();
                }
            });

            // ── Grand Total ──
            add(text(DIV)); lf();
            add(cmd.BOLD_ON);
            const totalLine = _pad('GRAND TOTAL:', 32) + _pad('Rs.' + grandTotal.toFixed(2), WIDTH - 32, 'right');
            add(text(totalLine)); lf();
            add(cmd.BOLD_OFF);
            add(text(DIV)); lf();

            // ── Footer ──
            add(cmd.ALIGN_CENTER);
            add(text(footerMsg)); lf();
            add(text('Powered by Billware')); lf();

            // ── 3 blank lines + cut ──
            lf(); lf(); lf();
            add(cmd.CUT);

            // ── Send all bytes ──
            await _send(bytes);
            console.log('[ThermalPrinter] Print sent successfully.');
            return true;

        } catch (e) {
            console.error('[ThermalPrinter] Print failed:', e);
            return false;
        }
    }

    // ── Auto-reconnect on module load ──────────────────────
    autoReconnect();

    return {
        isSupported,
        isConnected,
        connect,
        disconnect,
        print,
        getSavedPrinterName,
        autoReconnect,
    };
})();
