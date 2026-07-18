/* Excellence Agency — Main JS */

/* ── Navbar scroll effect ── */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

/* ── Mobile hamburger ── */
const hamburger = document.getElementById('hamburger');
const navLinks  = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  const isOpen = navLinks.classList.contains('open');
  hamburger.setAttribute('aria-expanded', isOpen);
});

navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => navLinks.classList.remove('open'));
});

/* ── Animated stats counter ── */
function animateCounter(el) {
  const target = parseInt(el.dataset.count, 10);
  const duration = 1800;
  const step = target / (duration / 16);
  let current = 0;

  const timer = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = Math.floor(current);
    if (current >= target) clearInterval(timer);
  }, 16);
}

const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.querySelectorAll('[data-count]').forEach(animateCounter);
      statsObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.4 });

const statsBar = document.querySelector('.stats-bar');
if (statsBar) statsObserver.observe(statsBar);

/* ── Scroll reveal ── */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.dest-card, .service-card, .step-card, .testi-card, .stat-item, .contact-item, .about-feature, .partner-card, .cert-card').forEach((el, i) => {
  el.setAttribute('data-reveal', '');
  el.setAttribute('data-reveal-delay', (i % 4) + 1);
  revealObserver.observe(el);
});

/* ── Multi-step form (only present on apply.html) ── */
const form = document.getElementById('applyForm');

if (form) {
  const formSuccess = document.getElementById('formSuccess');
  const stepDots    = document.querySelectorAll('.step-dot');
  const stepLines   = document.querySelectorAll('.step-line');
  let currentStep   = 1;
  const totalSteps  = 4;

  const showStep = (stepNum) => {
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    const target = document.querySelector(`.form-step[data-step="${stepNum}"]`);
    if (target) target.classList.add('active');

    stepDots.forEach((dot, idx) => {
      dot.classList.remove('active', 'done');
      if (idx + 1 < stepNum) dot.classList.add('done');
      if (idx + 1 === stepNum) dot.classList.add('active');
    });

    stepLines.forEach((line, idx) => {
      line.classList.toggle('done', idx + 1 < stepNum);
    });

    currentStep = stepNum;
  };

  const validateStep = (stepNum) => {
    const step = document.querySelector(`.form-step[data-step="${stepNum}"]`);
    if (!step) return true;

    let valid = true;

    step.querySelectorAll('input[required], select[required], textarea[required]').forEach(input => {
      input.classList.remove('error');

      if (input.type === 'radio' || input.type === 'checkbox') {
        const name    = input.name;
        const group   = step.querySelectorAll(`input[name="${name}"]`);
        const checked = [...group].some(i => i.checked);
        if (!checked) {
          valid = false;
          const wrapper = input.closest('.radio-group, .checkbox-group, .form-group');
          if (wrapper) wrapper.classList.add('error-group');
        }
      } else {
        if (!input.value.trim()) {
          input.classList.add('error');
          valid = false;
        }
      }
    });

    if (!valid) {
      const firstError = step.querySelector('.error, .error-group input');
      if (firstError) firstError.closest('.form-group')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return valid;
  };

  document.querySelectorAll('.next-step').forEach(btn => {
    btn.addEventListener('click', () => {
      if (validateStep(currentStep) && currentStep < totalSteps) showStep(currentStep + 1);
    });
  });

  document.querySelectorAll('.prev-step').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentStep > 1) showStep(currentStep - 1);
    });
  });

  form.addEventListener('input', e => e.target.classList.remove('error'));
  form.addEventListener('change', e => e.target.closest('.error-group')?.classList.remove('error-group'));

  const genEventId = () => 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);

  const getCookie = name => {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : undefined;
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateStep(4)) return;

    const nameVal = document.getElementById('fullName').value.trim();
    const checkedRadio = n => form.querySelector(`input[name="${n}"]:checked`)?.value || '';
    const eventId = genEventId();

    const payload = {
      name: nameVal,
      phone: document.getElementById('phone').value.trim(),
      source: 'apply',
      city: document.getElementById('city').value.trim(),
      educLevel: checkedRadio('educLevel'),
      destination: [...form.querySelectorAll('input[name="destination"]:checked')].map(i => i.value),
      specialty: document.getElementById('specialty').value,
      startDate: checkedRadio('startDate'),
      budget: checkedRadio('budget'),
      hearAbout: checkedRadio('source'),
      notes: document.getElementById('notes').value.trim(),
      eventId,
      eventSourceUrl: location.href,
      fbp: getCookie('_fbp'),
      fbc: getCookie('_fbc')
    };

    const submitBtn = form.querySelector('.btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'جاري الإرسال...';

    try {
      await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (_) { /* still show success below — don't block the UI on network issues */ }

    if (typeof fbq !== 'undefined') { fbq('track', 'Lead', {}, { eventID: eventId }); }

    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    formSuccess.classList.add('show');
    document.getElementById('successName').textContent = nameVal;
    stepDots.forEach(d => { d.classList.remove('active'); d.classList.add('done'); });
    stepLines.forEach(l => l.classList.add('done'));

    document.querySelector('.apply-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ── Smooth scroll for same-page anchor links ── */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  const href = anchor.getAttribute('href');
  if (href.length < 2) return;

  anchor.addEventListener('click', e => {
    const target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();
    const offset = navbar.offsetHeight + 16;
    const top    = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

/* ── Certificate lightbox (only present on certificates.html) ── */
const certLightbox = document.getElementById('certLightbox');

if (certLightbox) {
  const certLightboxImg   = document.getElementById('certLightboxImg');
  const certLightboxName  = document.getElementById('certLightboxName');
  const certLightboxClose = document.getElementById('certLightboxClose');

  document.querySelectorAll('.cert-card').forEach(card => {
    card.addEventListener('click', () => {
      certLightboxImg.src = card.dataset.src;
      certLightboxImg.alt = card.dataset.name;
      certLightboxName.textContent = card.dataset.name;
      certLightbox.classList.add('open');
    });
  });

  const closeCertLightbox = () => {
    certLightbox.classList.remove('open');
    certLightboxImg.src = '';
  };

  certLightboxClose.addEventListener('click', closeCertLightbox);
  certLightbox.addEventListener('click', e => {
    if (e.target === certLightbox) closeCertLightbox();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCertLightbox();
  });
}

/* ── Visa success carousel (homepage) ── */
const visaTrack = document.querySelector('.visa-track');

if (visaTrack) {
  visaTrack.innerHTML += visaTrack.innerHTML;

  const visaLightbox    = document.getElementById('visaLightbox');
  const visaLightboxImg = document.getElementById('visaLightboxImg');
  const visaLightboxClose = document.getElementById('visaLightboxClose');

  visaTrack.querySelectorAll('.visa-slide img').forEach(img => {
    img.parentElement.addEventListener('click', () => {
      visaLightboxImg.src = img.src;
      visaLightboxImg.alt = img.alt;
      visaLightbox.classList.add('open');
    });
  });

  const closeVisaLightbox = () => {
    visaLightbox.classList.remove('open');
    visaLightboxImg.src = '';
  };

  visaLightboxClose.addEventListener('click', closeVisaLightbox);
  visaLightbox.addEventListener('click', e => {
    if (e.target === visaLightbox) closeVisaLightbox();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeVisaLightbox();
  });
}

/* ── Hero photo slider rotation (used on pages with multiple .hero-slide) ── */
document.querySelectorAll('.hero-slider').forEach(slider => {
  const slides = slider.querySelectorAll('.hero-slide');
  if (slides.length < 2) return;

  let idx = Math.max(0, [...slides].findIndex(s => s.classList.contains('active')));

  setInterval(() => {
    slides[idx].classList.remove('active');
    idx = (idx + 1) % slides.length;
    slides[idx].classList.add('active');
  }, 5000);
});
