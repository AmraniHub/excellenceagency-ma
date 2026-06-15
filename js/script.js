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

document.querySelectorAll('.dest-card, .service-card, .step-card, .testi-card, .stat-item, .contact-item, .about-feature').forEach((el, i) => {
  el.setAttribute('data-reveal', '');
  el.setAttribute('data-reveal-delay', (i % 4) + 1);
  revealObserver.observe(el);
});

/* ── Multi-step form ── */
const form          = document.getElementById('applyForm');
const formSuccess   = document.getElementById('formSuccess');
const stepDots      = document.querySelectorAll('.step-dot');
const stepLines     = document.querySelectorAll('.step-line');
let currentStep     = 1;
const totalSteps    = 4;

function showStep(stepNum) {
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
}

function validateStep(stepNum) {
  const step = document.querySelector(`.form-step[data-step="${stepNum}"]`);
  if (!step) return true;

  let valid = true;

  step.querySelectorAll('input[required], select[required], textarea[required]').forEach(input => {
    input.classList.remove('error');

    if (input.type === 'radio' || input.type === 'checkbox') {
      const name   = input.name;
      const group  = step.querySelectorAll(`input[name="${name}"]`);
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
}

document.querySelectorAll('.next-step').forEach(btn => {
  btn.addEventListener('click', () => {
    if (validateStep(currentStep)) {
      if (currentStep < totalSteps) showStep(currentStep + 1);
    }
  });
});

document.querySelectorAll('.prev-step').forEach(btn => {
  btn.addEventListener('click', () => {
    if (currentStep > 1) showStep(currentStep - 1);
  });
});

/* Clear error styling on interaction */
form.addEventListener('input', e => e.target.classList.remove('error'));
form.addEventListener('change', e => e.target.closest('.error-group')?.classList.remove('error-group'));

/* Form submit */
form.addEventListener('submit', e => {
  e.preventDefault();
  if (!validateStep(4)) return;

  const nameVal = document.getElementById('fullName').value.trim();

  /* Simulate submission */
  const submitBtn = form.querySelector('.btn-submit');
  submitBtn.disabled  = true;
  submitBtn.textContent = 'جاري الإرسال...';

  setTimeout(() => {
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    formSuccess.classList.add('show');
    document.getElementById('successName').textContent = nameVal;
    stepDots.forEach(d => { d.classList.remove('active'); d.classList.add('done'); });
    stepLines.forEach(l => l.classList.add('done'));

    document.getElementById('apply').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 900);
});

/* ── Smooth scroll for anchor links ── */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', e => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    const offset = navbar.offsetHeight + 16;
    const top    = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

/* ── Active nav link on scroll ── */
const sections = document.querySelectorAll('section[id]');
const navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');

const sectionObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navAnchors.forEach(a => a.classList.remove('active'));
      const active = document.querySelector(`.nav-links a[href="#${entry.target.id}"]`);
      if (active) active.classList.add('active');
    }
  });
}, { rootMargin: '-40% 0px -40% 0px' });

sections.forEach(s => sectionObserver.observe(s));
