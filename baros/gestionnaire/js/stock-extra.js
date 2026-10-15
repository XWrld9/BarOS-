// ── BarOS Gestionnaire — photo, nom anglais, descriptions, allergènes ──
// (champs facultatifs du formulaire stock, affichés sur le menu client)
function stkPhotoSet(dataUrl) {
  var hid = document.getElementById('sph'), prev = document.getElementById('sph-prev'), del = document.getElementById('sph-del');
  if (!hid) return;
  hid.value = dataUrl || '';
  if (dataUrl) { prev.src = dataUrl; prev.style.display = 'block'; del.style.display = ''; }
  else { prev.removeAttribute('src'); prev.style.display = 'none'; del.style.display = 'none'; }
}
function stkPhotoClear() { stkPhotoSet(''); var f = document.getElementById('sph-file'); if (f) f.value = ''; }

// Réduit la photo (480 px max, JPEG) pour qu'elle reste légère
function stkPhotoPick(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) { showN('⚠️ Choisissez une image', 'warn'); return; }
  var reader = new FileReader();
  reader.onload = function (e) {
    var img = new Image();
    img.onload = function () {
      var max = 480, r = Math.min(1, max / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      stkPhotoSet(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = function () { showN('⚠️ Image illisible', 'warn'); };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function stkExtraFill(s) {
  function set(id, v) { var el = document.getElementById(id); if (el) el.value = v || ''; }
  set('sne', s && s.nom_en); set('sdf', s && s.description_fr); set('sde', s && s.description_en); set('sal', s && s.allergenes);
  stkPhotoSet(s && s.photo ? s.photo : '');
  var f = document.getElementById('sph-file'); if (f) f.value = '';
}

function stkExtraPayload() {
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  return {
    photo: val('sph') || null,
    nom_en: val('sne') || null,
    description_fr: val('sdf') || null,
    description_en: val('sde') || null,
    allergenes: val('sal') || null
  };
}
