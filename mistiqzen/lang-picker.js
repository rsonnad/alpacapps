// Language picker click-to-toggle for mobile touch devices
// Hover still works on desktop; this adds tap support
document.querySelectorAll('.mistiq-lang-picker__current').forEach(current => {
  current.addEventListener('click', (e) => {
    e.stopPropagation();
    const picker = current.closest('.mistiq-lang-picker');
    // Close any other open pickers
    document.querySelectorAll('.mistiq-lang-picker--open').forEach(p => {
      if (p !== picker) p.classList.remove('mistiq-lang-picker--open');
    });
    picker.classList.toggle('mistiq-lang-picker--open');
  });
});

// Close picker when clicking outside
document.addEventListener('click', () => {
  document.querySelectorAll('.mistiq-lang-picker--open').forEach(p => {
    p.classList.remove('mistiq-lang-picker--open');
  });
});

// Close picker when a flag link is clicked
document.querySelectorAll('.mistiq-lang-picker__flag').forEach(flag => {
  flag.addEventListener('click', () => {
    document.querySelectorAll('.mistiq-lang-picker--open').forEach(p => {
      p.classList.remove('mistiq-lang-picker--open');
    });
  });
});
