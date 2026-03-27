import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import net from "net";

const activeContainers = new Map<string, { port: number; containerId: string }>();

// Manifest files that BaxBench injects during build (not in code/ dir)
const MANIFEST_FILES: Record<string, Record<string, string>> = {
  "Python-Flask": {
    "requirements.txt": `flask
pyjwt[crypto]
bcrypt
cryptography
`,
  },
  "JavaScript-express": {
    "package.json": JSON.stringify(
      {
        dependencies: {
          express: "^4.18.0",
          "better-sqlite3": "^11.0.0",
          bcryptjs: "^2.4.3",
          jsonwebtoken: "^9.0.0",
          uuid: "^9.0.0",
          multer: "^1.4.5-lts.1",
          "cookie-parser": "^1.4.6",
          cors: "^2.8.5",
        },
      },
      null,
      2
    ),
  },
  "Go-Fiber": {
    "go.mod": `module myapp

go 1.23.4

require github.com/gofiber/fiber/v2 v2.52.6
require github.com/mattn/go-sqlite3 v1.14.24
require github.com/golang-jwt/jwt/v5 v5.2.1
require github.com/google/uuid v1.6.0
require golang.org/x/crypto v0.32.0
`,
    "build_helper.go": `package main

import (
  "fmt"
  _ "github.com/mattn/go-sqlite3"
  _ "github.com/golang-jwt/jwt/v5"
  _ "github.com/google/uuid"
  _ "golang.org/x/crypto/bcrypt"
  _ "github.com/gofiber/fiber/v2"
)

func main() {
  fmt.Println("build helper")
}
`,
  },
};

const DOCKERFILES: Record<string, string> = {
  "Python-Flask": `FROM nikolaik/python-nodejs:python3.12-nodejs22-bullseye
RUN apt-get update
RUN apt-get install sqlite3 -y
RUN mkdir -p /app
WORKDIR /app
COPY requirements.txt requirements.txt
RUN python3 -m pip install -r requirements.txt
ENV APP_SECRET=supers3cret
COPY / /app/
ENTRYPOINT ["python3", "app.py"]`,

  "JavaScript-express": `FROM node:22.12-bullseye
RUN apt-get update
RUN apt-get install sqlite3 -y
RUN mkdir -p /app
WORKDIR /app
COPY package.json package.json
RUN npm install
COPY * /app/
ENV APP_SECRET=supers3cret
ENTRYPOINT ["node", "app.js"]`,

  "Go-Fiber": `FROM golang:1.23-bullseye
RUN apt-get update
RUN apt-get install sqlite3 gcc build-essential -y
RUN go install golang.org/x/tools/cmd/goimports@v0.36.0
RUN mkdir -p /app
WORKDIR /app
COPY go.mod build_helper.go ./
RUN go get myapp
RUN go install
RUN CGO_ENABLED=1 go build .
COPY * ./
RUN rm -rf build_helper.go myapp
RUN goimports -w .
RUN go mod tidy || echo "go mod tidy failed"
RUN CGO_ENABLED=1 go build . || echo "build failed"
ENV APP_SECRET=supers3cret
ENTRYPOINT ["./myapp"]`,
};

function getFrameworkBase(framework: string): string {
  if (framework.includes("Flask") || framework.includes("FastAPI") || framework.includes("Django"))
    return "Python-Flask";
  if (framework.includes("express") || framework.includes("koa") || framework.includes("nest"))
    return "JavaScript-express";
  if (framework.includes("Fiber") || framework.includes("Gin") || framework.includes("net/http"))
    return "Go-Fiber";
  return framework;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("Could not get port"));
      }
    });
  });
}

export function checkDocker(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function buildAndRun(
  codePath: string,
  framework: string
): Promise<{ port: number; containerId: string }> {
  const base = getFrameworkBase(framework);
  const dockerfile = DOCKERFILES[base];
  if (!dockerfile) throw new Error(`Unknown framework: ${framework}`);

  const port = await getFreePort();
  const tag = `baxbench-preview-${Date.now()}`;

  // Create a temporary build directory with code + manifest files
  const buildDir = path.join(
    process.env.HOME || "/tmp",
    ".baxbench-preview",
    `build-${Date.now()}`
  );
  fs.mkdirSync(buildDir, { recursive: true });

  try {
    // Copy all code files to build dir
    const codeFiles = fs.readdirSync(codePath);
    for (const f of codeFiles) {
      if (!f.startsWith(".")) {
        fs.copyFileSync(path.join(codePath, f), path.join(buildDir, f));
      }
    }

    // Write manifest files (go.mod, requirements.txt, package.json, etc.)
    const manifests = MANIFEST_FILES[base] ?? {};
    for (const [filename, content] of Object.entries(manifests)) {
      // Only write if not already present (model might have generated it)
      if (!fs.existsSync(path.join(buildDir, filename))) {
        fs.writeFileSync(path.join(buildDir, filename), content);
      }
    }

    // Write Dockerfile
    fs.writeFileSync(path.join(buildDir, "Dockerfile"), dockerfile);

    // Build
    execSync(`docker build -t ${tag} .`, {
      cwd: buildDir,
      stdio: "pipe",
      timeout: 180000,
    });

    // Run
    const result = execSync(
      `docker run -d -p ${port}:5000 --memory=1g --name baxbench-preview-${port} ${tag}`,
      { cwd: buildDir, stdio: "pipe", timeout: 10000 }
    );
    const containerId = result.toString().trim().substring(0, 12);

    activeContainers.set(containerId, { port, containerId });
    return { port, containerId };
  } finally {
    // Clean up build directory
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
}

export function stopContainer(containerId: string): void {
  try {
    execSync(`docker stop ${containerId}`, { stdio: "pipe", timeout: 10000 });
  } catch {}
  try {
    execSync(`docker rm ${containerId}`, { stdio: "pipe", timeout: 10000 });
  } catch {}
  activeContainers.delete(containerId);
}

export function cleanupAll(): void {
  for (const [id] of activeContainers) {
    stopContainer(id);
  }
}

export function getActiveContainers() {
  return Array.from(activeContainers.values());
}
