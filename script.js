/* ==========================================================================
   Body Scent — script.js
   Shared by every page. Each section runs only if its elements exist,
   so the same file can be loaded on product.html, order.html and admin.html.

   Element IDs this file expects (HTML must use exactly these):
     product.html : #filter-bar, #product-list
     order.html   : #orderForm, #customerName, #contact, #items, #total, #note
     admin.html   : #ordersTable  (must contain a <tbody>)
   ========================================================================== */
(function () {
  'use strict';

  /* ---- Config ----------------------------------------------------------- */
  const PRODUCTS_URL = 'products.json';
  const ORDER_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwZ2YoH8ah4gOEWDsW59RkrzAQRumU3Zz8c3JP2N6wB-MSzVaVajGPpQmYfev8SeL5TmA/exec';
  const ORDERS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRTqj7D-vMxlSqzZJNmTZnLy_TDwz0uncd2vmWzhUhZ3VeJmJMBjC9c2KYt_o2vkxhfOx4qt2cAIjA5/pub?gid=0&single=true&output=csv';

  const MOODS = [
    { key: 'all', label: 'ทั้งหมด' },
    { key: 'fresh', label: 'Fresh' },
    { key: 'sweet', label: 'Sweet' },
    { key: 'confident', label: 'Confident' },
    { key: 'romance', label: 'Romance' }
  ];

  /* ---- Helpers ---------------------------------------------------------- */
  // Build elements with textContent only (never innerHTML) so product / order
  // text can never be interpreted as HTML.
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function fieldValue(id) {
    const field = document.getElementById(id);
    return field ? field.value.trim() : '';
  }

  /* ==========================================================================
     1. product.html — product cards + mood filter
     ========================================================================== */
  function initProducts() {
    const filterBar = document.getElementById('filter-bar');
    const list = document.getElementById('product-list');
    if (!filterBar || !list) return;

    // ?mood=fresh pre-selects a filter; unknown values fall back to "all"
    const requested = (new URLSearchParams(window.location.search).get('mood') || '').toLowerCase();
    let activeMood = MOODS.some(function (m) { return m.key === requested; }) ? requested : 'all';
    let products = [];

    function showMessage(text) {
      list.textContent = '';
      const msg = el('p', 'text-center', text);
      msg.style.gridColumn = '1 / -1';
      list.appendChild(msg);
    }

    function moodName(key) {
      const mood = MOODS.find(function (m) { return m.key === key; });
      return mood ? mood.label : key;
    }

    function formatPrice(price) {
      return Number(price).toLocaleString('en-US') + ' บาท';
    }

    function buildCard(p) {
      // Same text that goes to the order page, e.g. "น้ำหอมฉีดตัว Fresh เล็ก 30ml"
      const itemName = p.size ? p.name + ' ' + p.size : p.name;

      const card = el('article', 'product-card');
      card.dataset.mood = p.mood;

      const media = el('div', 'product-card__media');
      const img = el('img');
      // Photo missing (404)? Show a quiet mood placeholder instead of a broken-image icon.
      img.addEventListener('error', function () {
        img.remove();
        media.classList.add('product-card__media--empty');
        const label = el('span', 'mood-label');
        label.appendChild(el('span', 'mood-dot'));
        label.appendChild(document.createTextNode(moodName(p.mood)));
        media.appendChild(label);
      }, { once: true });
      img.src = p.image;
      img.alt = p.name;
      img.loading = 'lazy';
      media.appendChild(img);

      const body = el('div', 'product-card__body');
      body.appendChild(el('h3', 'product-card__name', p.name));
      if (p.size) body.appendChild(el('p', 'product-card__meta', p.size)); // roll-on has size = null

      const footer = el('div', 'product-card__footer');
      footer.appendChild(el('span', 'price', formatPrice(p.price)));

      const orderLink = el('a', 'btn btn--gold btn--block', 'สั่งซื้อ');
      orderLink.href = 'order.html?' + new URLSearchParams({ item: itemName, price: String(p.price) }).toString();
      footer.appendChild(orderLink);

      body.appendChild(footer);
      card.appendChild(media);
      card.appendChild(body);
      return card;
    }

    function renderProducts() {
      const visible = activeMood === 'all'
        ? products
        : products.filter(function (p) { return p.mood === activeMood; });

      if (!visible.length) {
        showMessage('ไม่พบสินค้า');
        return;
      }
      list.textContent = '';
      visible.forEach(function (p) { list.appendChild(buildCard(p)); });
    }

    // Buttons are created once and only restyled on click, so keyboard focus is kept.
    function updateFilterButtons() {
      filterBar.querySelectorAll('button').forEach(function (btn) {
        const isActive = btn.dataset.filter === activeMood;
        btn.classList.toggle('btn--solid', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
      });
    }

    function buildFilterButtons() {
      filterBar.textContent = '';
      MOODS.forEach(function (m) {
        const btn = el('button', 'btn', m.label);
        btn.type = 'button';
        btn.dataset.filter = m.key;
        btn.addEventListener('click', function () {
          activeMood = m.key;
          updateFilterButtons();
          renderProducts();
        });
        filterBar.appendChild(btn);
      });
      updateFilterButtons();
    }

    buildFilterButtons();
    showMessage('กำลังโหลดสินค้า...');

    fetch(PRODUCTS_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('products.json: HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        products = data;
        renderProducts();
      })
      .catch(function (error) {
        console.error(error);
        showMessage('โหลดรายการสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      });
  }

  /* ==========================================================================
     2. order.html — prefill from URL, then submit to Apps Script
     ========================================================================== */
  function initOrder() {
    const form = document.getElementById('orderForm');
    if (!form) return;

    // Prefill: order.html?item=...&price=...  ->  #items and #total
    const params = new URLSearchParams(window.location.search);
    const itemsField = document.getElementById('items');
    const totalField = document.getElementById('total');

    if (!itemsField || !totalField) {
      console.warn('order.html needs elements with id="items" and id="total"');
    }
    if (itemsField && params.has('item')) itemsField.value = params.get('item');
    if (totalField && params.has('price')) totalField.value = params.get('price');

    let submitting = false;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (submitting) return; // ignore double clicks, avoids duplicate orders

      const payload = {
        customerName: fieldValue('customerName'),
        contact: fieldValue('contact'),
        items: fieldValue('items'),
        total: fieldValue('total'),
        note: fieldValue('note')
      };

      const submitBtn = form.querySelector('[type="submit"]');
      submitting = true;
      if (submitBtn) submitBtn.disabled = true;

      // Pattern verified with Apps Script: no custom headers, no mode: 'no-cors'.
      fetch(ORDER_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify(payload)
      })
        .then(() => { window.location.href = 'thankyou.html'; })
        .catch(error => {
          console.error(error);
          alert('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
          submitting = false;
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  }

  /* ==========================================================================
     3. admin.html — orders table from the published Google Sheet (CSV)
     ========================================================================== */

  // Minimal RFC 4180 parser: quoted fields, "" escapes, commas and newlines
  // inside quotes, CRLF / LF / CR line endings, optional UTF-8 BOM.
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { // last line without trailing newline
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function initAdmin() {
    const tbody = document.querySelector('#ordersTable tbody');
    if (!tbody) return;

    // Columns: timestamp, customer name, contact, items, total, note
    const COLUMNS = 6;

    function showMessage(text) {
      tbody.textContent = '';
      const tr = el('tr');
      const td = el('td', '', text);
      td.colSpan = COLUMNS;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    showMessage('กำลังโหลดข้อมูล...');

    fetch(ORDERS_CSV_URL, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('orders CSV: HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        let rows = parseCSV(text).filter(function (r) {
          return r.some(function (cell) { return cell.trim() !== ''; });
        });

        // Header row = first cell has no digit (a timestamp always does)
        if (rows.length && !/\d/.test(rows[0][0])) rows = rows.slice(1);

        // The sheet is append-only, so reversing row order = newest first.
        rows.reverse();

        if (!rows.length) {
          showMessage('ยังไม่มีรายการสั่งซื้อ');
          return;
        }

        tbody.textContent = '';
        rows.forEach(function (row) {
          const tr = el('tr');
          for (let i = 0; i < COLUMNS; i++) {
            tr.appendChild(el('td', '', row[i] !== undefined ? row[i] : ''));
          }
          tbody.appendChild(tr);
        });
      })
      .catch(function (error) {
        console.error(error);
        showMessage('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      });
  }

  /* ---- Boot ------------------------------------------------------------- */
  function init() {
    initProducts();
    initOrder();
    initAdmin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
