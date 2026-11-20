FROM node:24-slim

WORKDIR /app

# The fixture has no runtime dependencies. Type imports from the console's
# contract are erased by node's type stripping, so only fixture/ is needed.
COPY fixture/package.json ./fixture/
COPY fixture/src ./fixture/src

USER node
EXPOSE 8022
CMD ["node", "fixture/src/server.ts"]
