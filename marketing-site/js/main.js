/* ============================================================
   Turbo EA Marketing Site — Interactivity
   ============================================================ */

(function () {
  'use strict';

  // --- Scroll-triggered fade-in animations ---
  const fadeElements = document.querySelectorAll('.fade-in');

  const fadeObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          fadeObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  fadeElements.forEach((el) => fadeObserver.observe(el));

  // --- Sticky nav background on scroll ---
  const nav = document.getElementById('nav');
  let lastScroll = 0;

  function updateNav() {
    const scrollY = window.scrollY;
    if (scrollY > 50) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
    lastScroll = scrollY;
  }

  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();

  // --- Mobile nav toggle ---
  const navToggle = document.getElementById('nav-toggle');
  const navLinks = document.getElementById('nav-links');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navToggle.classList.toggle('open');
      navLinks.classList.toggle('open');
      document.body.style.overflow = navLinks.classList.contains('open')
        ? 'hidden'
        : '';
    });

    // Close mobile nav on link click
    navLinks.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navToggle.classList.remove('open');
        navLinks.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  // --- Report tabs ---
  const reportTabs = document.querySelectorAll('.report-tab');
  const reportPanels = document.querySelectorAll('.report-panel');

  reportTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const reportKey = tab.dataset.report;

      // Update tabs
      reportTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      // Update panels
      reportPanels.forEach((panel) => {
        if (panel.dataset.report === reportKey) {
          panel.classList.add('active');
        } else {
          panel.classList.remove('active');
        }
      });
    });
  });

  // --- Copy command button ---
  const copyBtn = document.getElementById('copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const command = 'docker compose up --build -d';
      navigator.clipboard.writeText(command).then(() => {
        copyBtn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
        setTimeout(() => {
          copyBtn.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 2000);
      });
    });
  }

  // --- Smooth scroll for anchor links ---
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;

      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const navHeight = nav.offsetHeight;
        const targetPosition =
          target.getBoundingClientRect().top + window.scrollY - navHeight - 20;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth',
        });
      }
    });
  });

  // --- Animated quality bars on scroll ---
  const qualityBars = document.querySelectorAll('.quality-bar-fill');
  const qualityObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const fill = entry.target;
          const targetWidth = fill.style.width;
          fill.style.width = '0%';
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              fill.style.width = targetWidth;
            });
          });
          qualityObserver.unobserve(fill);
        }
      });
    },
    { threshold: 0.5 }
  );

  qualityBars.forEach((bar) => qualityObserver.observe(bar));

  // --- Terminal typing animation ---
  const terminalLines = document.querySelectorAll('.terminal-line');
  let terminalAnimated = false;

  const terminalObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !terminalAnimated) {
          terminalAnimated = true;
          animateTerminal();
          terminalObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.3 }
  );

  const terminalEl = document.querySelector('.terminal');
  if (terminalEl) {
    terminalObserver.observe(terminalEl);
  }

  function animateTerminal() {
    terminalLines.forEach((line, i) => {
      line.style.opacity = '0';
      line.style.transform = 'translateY(8px)';
      line.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

      setTimeout(() => {
        line.style.opacity = '1';
        line.style.transform = 'translateY(0)';
      }, i * 200);
    });
  }

  // --- Layer cards stagger animation ---
  const layerCards = document.querySelectorAll('.layer-card');

  const layerObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const cards = entry.target.parentElement.querySelectorAll('.layer-card');
          cards.forEach((card, i) => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            card.style.transition = `opacity 0.5s ease ${i * 0.1}s, transform 0.5s ease ${i * 0.1}s`;

            requestAnimationFrame(() => {
              card.style.opacity = '1';
              card.style.transform = 'translateY(0)';
            });
          });
          layerObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );

  if (layerCards.length > 0) {
    layerObserver.observe(layerCards[0]);
  }

  // --- Feature cards stagger animation ---
  const featureCards = document.querySelectorAll('.feature-card');

  const featureObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const idx = Array.from(featureCards).indexOf(entry.target);
          entry.target.style.transitionDelay = `${idx * 0.05}s`;
          entry.target.classList.add('visible');
          featureObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -20px 0px' }
  );

  featureCards.forEach((card) => featureObserver.observe(card));

  // --- Parallax effect on hero grid ---
  const heroGrid = document.querySelector('.hero-grid');
  if (heroGrid) {
    window.addEventListener(
      'scroll',
      () => {
        const scrollY = window.scrollY;
        if (scrollY < window.innerHeight) {
          heroGrid.style.transform = `translateY(${scrollY * 0.3}px)`;
        }
      },
      { passive: true }
    );
  }
})();
