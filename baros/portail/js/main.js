(function () {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().catch(function () {});
  }
})();
