# Bauanleitung für den Hosting-Anbieter: Node.js + die Anwendung.
FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./
COPY lib ./lib
COPY public ./public

# Hier liegen alle Tests, Antworten und Ergebnisse. Beim Anbieter einen dauerhaften Speicher ("Volume") unter /daten einhängen!
# (Bei Railway wird der dort gewählte Pfad automatisch erkannt.)
ENV DATEN_ORDNER=/daten
ENV PORT=3000
ENV NODE_ENV=production
RUN mkdir -p /daten

EXPOSE 3000
CMD ["node", "server.js"]
