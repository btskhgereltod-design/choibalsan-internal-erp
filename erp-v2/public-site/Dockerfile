FROM nginxinc/nginx-unprivileged:1.31.4-alpine
ARG NGINX_CONFIG=nginx.conf
COPY ${NGINX_CONFIG} /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY status.html /usr/share/nginx/html/status.html
COPY site.css /usr/share/nginx/html/site.css
COPY market-catalog.css /usr/share/nginx/html/market-catalog.css
COPY conversation-memory.js /usr/share/nginx/html/conversation-memory.js
COPY workspace-lifecycle.js /usr/share/nginx/html/workspace-lifecycle.js
COPY workspace-registry.js /usr/share/nginx/html/workspace-registry.js
COPY workspace-intake.js /usr/share/nginx/html/workspace-intake.js
COPY request-draft-registry.js /usr/share/nginx/html/request-draft-registry.js
COPY site.js /usr/share/nginx/html/site.js
COPY market-catalog.js /usr/share/nginx/html/market-catalog.js
COPY overva-organization-template.csv /usr/share/nginx/html/overva-organization-template.csv
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
