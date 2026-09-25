FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --fund=false

FROM node:24-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=/api
ARG INTERNAL_API_URL=http://backend:4000
# The public half of the offline signing key. NEXT_PUBLIC_* is inlined at build
# time, so a value supplied at run time can never reach the browser: without it
# here, verifyOfflineAccessToken returns "verification-key-unavailable" for every
# token, getValidOfflineAccess returns null, and the admin shell's offline mode
# is silently dead in production while working perfectly in development.
# Safe to bake — it is a public key. One line, with literal \n escapes.
ARG NEXT_PUBLIC_OFFLINE_ACCESS_PUBLIC_KEY=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV INTERNAL_API_URL=$INTERNAL_API_URL
ENV NEXT_PUBLIC_OFFLINE_ACCESS_PUBLIC_KEY=$NEXT_PUBLIC_OFFLINE_ACCESS_PUBLIC_KEY
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next-prod/standalone ./
COPY --from=builder /app/.next-prod/static ./.next-prod/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
