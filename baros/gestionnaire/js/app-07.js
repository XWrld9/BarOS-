let _qrFullNom = '';
let _qrFullSrc = '';
let _qrFullEmpId = '';

// Appelé depuis les data-attributes de l'img pour éviter les problèmes d'échappement
function viewEmpQR(img) {
  if (!img) return;
  const nom   = img.dataset.nom  || '';
  const role  = img.dataset.role || 'Employé';
  const empId = img.dataset.id   || '';
  const src   = img.src;
  openQRFullscreen(nom, role, src, empId);
}

function openQRFullscreen(nom, poste, src, empId) {
  _qrFullNom   = nom;
  _qrFullSrc   = src;
  _qrFullEmpId = empId || '';
  document.getElementById('qrf-nom').textContent = nom;
  document.getElementById('qrf-sub').textContent = poste || 'Badge de pointage';
  document.getElementById('qrf-img').src = src;
  const info = document.getElementById('qrf-id-info');
  // BAROS QR FIX — afficher l'ID employé réel (UUID Supabase)
  if (info) info.textContent = empId ? 'ID : ' + empId : '';
  document.getElementById('qr-fullscreen').classList.add('open');
}

function closeQRFullscreen() {
  document.getElementById('qr-fullscreen').classList.remove('open');
}

document.getElementById('qr-fullscreen').addEventListener('click', function(e) {
  if (e.target === this) closeQRFullscreen();
});

function exportQRImage() {
  // BAROS QR FIX — Télécharger QR badge (image PNG)
  // QR ERROR HANDLING
  if (!_qrFullSrc) { showN('❌ Aucun QR à télécharger', 'error'); return; }
  try {
    // Composer le badge sur un canvas avec nom + QR
    const canvas = document.createElement('canvas');
    const W = 600, H = 750;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Fond sombre
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);

    // Logo/titre BarOS
    ctx.fillStyle = '#c8f55a';
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BarOS', W / 2, 70);

    // Sous-titre
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '22px sans-serif';
    ctx.fillText('Badge de pointage', W / 2, 108);

    // Cadre QR
    const qrSize = 340, qrX = (W - qrSize) / 2, qrY = 130;
    ctx.strokeStyle = '#c8f55a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 16);
    ctx.stroke();

    // Fond blanc derrière le QR
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(qrX, qrY, qrSize, qrSize);

    // QR image
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

      // Ligne décorative
      ctx.strokeStyle = 'rgba(200,245,90,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(40, qrY + qrSize + 30);
      ctx.lineTo(W - 40, qrY + qrSize + 30);
      ctx.stroke();

      // Nom employé
      ctx.fillStyle = '#f0eff5';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(_qrFullNom, W / 2, qrY + qrSize + 70);

      // Rôle
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '20px sans-serif';
      const sub = document.getElementById('qrf-sub').textContent || 'Employé';
      ctx.fillText(sub, W / 2, qrY + qrSize + 104);

      // BAROS QR FIX — ID UUID réel (plus de préfixe BAROS-EMP-)
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '13px monospace';
      if (_qrFullEmpId) ctx.fillText('ID : ' + _qrFullEmpId, W / 2, qrY + qrSize + 134);

      // Pied de page
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = '14px sans-serif';
      ctx.fillText('© BarOS — Système de gestion', W / 2, H - 24);

      // Télécharger — BAROS QR FIX : le lien doit être attaché au DOM avant le click()
      // (sur certains navigateurs / WebView Android en contexte PWA, click() sur un
      // <a> non attaché au DOM est silencieusement ignoré, d'où des échecs aléatoires)
      const link = document.createElement('a');
      link.download = 'badge-' + (_qrFullNom || 'employe').replace(/\s+/g, '-').toLowerCase() + '.png';
      link.href = canvas.toDataURL('image/png');
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showN('📥 Badge téléchargé', 'success');
    };
    img.onerror = () => showN('❌ Erreur chargement image QR', 'error');
    img.src = _qrFullSrc;
  } catch(e) {
    // QR ERROR HANDLING
    showN('❌ Erreur export image : ' + e.message, 'error');
    console.error('[BarOS] exportQRImage erreur:', e);
  }
}

function exportQRpdfBadge() {
  // BAROS QR FIX — Imprimer badge employé (PDF)
  // MOBILE QR SUPPORT : ouvre la boîte de dialogue d'impression
  if (!_qrFullSrc) { showN('❌ Aucun QR à imprimer', 'error'); return; }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });

    doc.setFillColor(10, 10, 15);
    doc.rect(0, 0, 210, 297, 'F');

    doc.setFont('helvetica','bold');
    doc.setFontSize(30);
    doc.setTextColor(200, 245, 90);
    doc.text('BarOS', 105, 28, { align:'center' });

    doc.setFontSize(11);
    doc.setTextColor(140, 140, 160);
    doc.text('Badge de pointage', 105, 38, { align:'center' });

    const qrSize = 115;
    const qrX = (210 - qrSize) / 2;
    const qrY = 50;
    doc.addImage(_qrFullSrc, 'PNG', qrX, qrY, qrSize, qrSize);
    doc.setDrawColor(200, 245, 90);
    doc.setLineWidth(0.7);
    doc.roundedRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 4, 4, 'S');

    doc.setFontSize(20);
    doc.setTextColor(240, 239, 245);
    doc.setFont('helvetica','bold');
    doc.text(_qrFullNom, 105, qrY + qrSize + 18, { align:'center' });

    const role = document.getElementById('qrf-sub').textContent || 'Employé';
    doc.setFontSize(12);
    doc.setTextColor(140, 140, 160);
    doc.setFont('helvetica','normal');
    doc.text(role, 105, qrY + qrSize + 28, { align:'center' });

    if (_qrFullEmpId) {
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 100);
      // BAROS QR FIX — afficher l'ID UUID réel (plus de préfixe BAROS-EMP-)
      doc.text('ID : ' + _qrFullEmpId, 105, qrY + qrSize + 38, { align:'center' });
    }

    doc.setDrawColor(200, 245, 90);
    doc.setLineWidth(0.3);
    doc.line(25, qrY + qrSize + 45, 185, qrY + qrSize + 45);

    doc.setFontSize(9);
    doc.setTextColor(80, 80, 100);
    doc.text('Présentez ce badge devant le scanner pour pointer', 105, qrY + qrSize + 53, { align:'center' });
    doc.text('© BarOS — Système de gestion', 105, 287, { align:'center' });

    // MOBILE QR SUPPORT : autoPrint ouvre l'impression sur Android/PWA/Chrome
    doc.autoPrint();
    // Ouvrir dans un nouvel onglet pour impression mobile
    const pdfBlob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    window.open(pdfUrl, '_blank');
    showN('🖨️ Badge prêt à imprimer', 'success');
  } catch(e) {
    // QR ERROR HANDLING
    showN('❌ Erreur impression badge : ' + e.message, 'error');
    console.error('[BarOS] exportQRpdfBadge erreur:', e);
  }
}
