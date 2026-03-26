FROM node:20

# Install build tools (needed for sqlite3)
RUN apt-get update && apt-get install -y python3 make g++

WORKDIR /app

COPY package*.json ./

# Force rebuild from source
RUN npm install --build-from-source

COPY . .

EXPOSE 5000
CMD ["node", "app.js"]