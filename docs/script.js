/* script.js */

document.addEventListener('DOMContentLoaded', () => {
  // --- Dark Mode ---
  const themeToggle = document.getElementById('theme-toggle');
  const html = document.documentElement;
  
  // Initialize theme
  if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    html.classList.add('dark');
  }

  themeToggle.addEventListener('click', () => {
    html.classList.toggle('dark');
    if (html.classList.contains('dark')) {
      localStorage.setItem('theme', 'dark');
    } else {
      localStorage.setItem('theme', 'light');
    }
  });

  // --- Mobile Sidebar Toggle ---
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');

  const toggleSidebar = () => {
    sidebar.classList.toggle('-translate-x-full');
    overlay.classList.toggle('hidden');
    document.body.classList.toggle('overflow-hidden');
  };

  if (mobileMenuBtn && sidebar && overlay) {
    mobileMenuBtn.addEventListener('click', toggleSidebar);
    overlay.addEventListener('click', toggleSidebar);
  }

  // --- Copy Code Blocks ---
  const codeBlocks = document.querySelectorAll('pre');
  codeBlocks.forEach((block) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    
    // Wrap pre
    block.parentNode.insertBefore(wrapper, block);
    wrapper.appendChild(block);

    // Create copy button
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
      Copy
    `;
    wrapper.appendChild(btn);

    btn.addEventListener('click', async () => {
      const code = block.innerText;
      try {
        await navigator.clipboard.writeText(code);
        btn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Copied!
        `;
        setTimeout(() => {
          btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            Copy
          `;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy', err);
      }
    });
  });

  // --- Active Link Highlight & Smooth Scroling ---
  const sections = document.querySelectorAll('.prose h2, .prose h3');
  const tocLinks = document.querySelectorAll('.toc-link');
  const sidebarLinks = document.querySelectorAll('.sidebar-link');

  // Simple scroll spy
  window.addEventListener('scroll', () => {
    let current = '';
    const scrollPos = window.scrollY + 100; // offset for sticky header
    sections.forEach(section => {
      if (section.offsetTop <= scrollPos) {
        current = section.getAttribute('id');
      }
    });

    tocLinks.forEach(link => {
      link.classList.remove('text-foreground', 'font-medium');
      link.classList.add('text-muted-foreground');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.remove('text-muted-foreground');
        link.classList.add('text-foreground', 'font-medium');
      }
    });
    
    // Simplistic sidebar active link (assuming href matches id)
    sidebarLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.add('active');
      }
    });
  });

  // --- Search Filter ---
  const searchInput = document.getElementById('search-input');
  if(searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      sidebarLinks.forEach(link => {
        const text = link.textContent.toLowerCase();
        if (text.includes(term)) {
          link.style.display = 'block';
        } else {
          link.style.display = 'none';
        }
      });
    });
  }

  // --- Page Transition ---
  document.querySelector('main').classList.add('fade-enter');
  setTimeout(() => {
    document.querySelector('main').classList.add('fade-enter-active');
  }, 10);
});
