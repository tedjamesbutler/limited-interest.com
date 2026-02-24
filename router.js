/**
 * Simple SPA Router
 * Intercepts link clicks, fetches content partials, updates the page
 */

class Router {
    constructor(contentEl, options = {}) {
        this.contentEl = contentEl;
        this.basePath = options.basePath || '/pages';
        this.defaultPage = options.defaultPage || 'home';
        this.onNavigate = options.onNavigate || (() => {});

        this.init();
    }

    init() {
        // Handle link clicks
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (!link) return;

            const href = link.getAttribute('href');
            if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) return;

            e.preventDefault();
            this.navigate(href);
        });

        // Handle browser back/forward
        window.addEventListener('popstate', () => {
            this.loadPage(window.location.pathname, false);
        });

        // Initial load
        this.loadPage(window.location.pathname, false);
    }

    navigate(path) {
        this.loadPage(path, true);
    }

    async loadPage(path, pushState = true) {
        // Normalize path
        let pageName = this.pathToPage(path);
        let pagePath = `${this.basePath}/${pageName}.html`;

        try {
            const response = await fetch(pagePath);
            if (!response.ok) {
                const notFound = await fetch(`${this.basePath}/404.html`);
                if (notFound.ok) {
                    this.contentEl.innerHTML = await notFound.text();
                } else {
                    this.contentEl.innerHTML = '<h1>Page not found</h1>';
                }
                return;
            }

            const html = await response.text();
            this.contentEl.innerHTML = html;

            // Update URL
            if (pushState) {
                const displayPath = pageName === this.defaultPage ? '/' : `/${pageName}.html`;
                window.history.pushState({}, '', displayPath);
            }

            // Update page title
            const titleEl = this.contentEl.querySelector('h1');
            if (titleEl) {
                document.title = titleEl.textContent + ' | Limited Interest';
            } else {
                document.title = 'Limited Interest';
            }

            // Scroll to top
            window.scrollTo(0, 0);

            // Update active nav link
            this.updateActiveNav(pageName);

            // Callback for post-navigation setup
            this.onNavigate(pageName, this.contentEl);

        } catch (error) {
            console.error('Router error:', error);
            this.contentEl.innerHTML = '<h1>Error loading page</h1>';
        }
    }

    updateActiveNav(pageName) {
        const navLinks = document.querySelectorAll('nav a');
        navLinks.forEach(link => {
            const linkPage = this.pathToPage(link.getAttribute('href'));
            const isActive = pageName === linkPage || pageName.startsWith(linkPage + '/');
            link.classList.toggle('active', isActive);
        });
    }

    pathToPage(path) {
        if (path === '/' || path === '') return this.defaultPage;

        // Remove leading slash and .html extension
        let page = path.replace(/^\//, '').replace(/\.html$/, '');

        // Handle index
        if (page === 'index' || page === '') return this.defaultPage;

        return page;
    }
}
