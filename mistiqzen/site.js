// Mobile menu + header scroll behavior (shared by all Mistiq Zen pages)
(function () {
  const menuToggle = document.getElementById('mistiq-menu-toggle');
  const mobileNav = document.getElementById('mistiq-mobile-nav');
  const mobileNavClose = document.getElementById('mistiq-mobile-nav-close');
  const closeNav = () => {
    mobileNav.classList.remove('mistiq-mobile-nav--open');
    document.body.style.overflow = '';
  };

  menuToggle.addEventListener('click', () => {
    mobileNav.classList.add('mistiq-mobile-nav--open');
    document.body.style.overflow = 'hidden';
  });
  mobileNavClose.addEventListener('click', closeNav);
  mobileNav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeNav));

  const header = document.getElementById('mistiq-header');
  if (header.dataset.solid) return; // booking pages keep a solid header
  const onScroll = () => header.classList.toggle('mistiq-header--scrolled', window.scrollY > 50);
  window.addEventListener('scroll', onScroll);
  onScroll();
})();

// Map facade: the Google Maps embed is heavy on older phones, so load it only on tap
document.querySelectorAll('.zen-map-facade').forEach(btn => {
  btn.addEventListener('click', () => {
    const iframe = document.createElement('iframe');
    iframe.className = 'zen-location__map';
    iframe.title = 'Map';
    iframe.src = btn.dataset.src;
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    btn.replaceWith(iframe);
  });
});
