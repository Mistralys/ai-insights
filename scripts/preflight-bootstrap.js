import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function bootstrap() {
  const root = path.resolve(import.meta.dirname, '..');
  
  // In case of local dev, try to find original repos if they are siblings
  const workspaceRoot = path.resolve(root, '..');
  const cliMenuDir = path.join(workspaceRoot, 'cli-menu');
  const personaBuilderDir = path.join(workspaceRoot, 'ai-persona-builder');
  
  const packages = [
    { name: '@mistralys/persona-builder', dir: personaBuilderDir },
    { name: '@mistralys/cli-menu', dir: cliMenuDir }
  ];

  let builtAny = false;

  for (const pkg of packages) {
    if (!fs.existsSync(pkg.dir)) continue;

    const distDir = path.join(pkg.dir, 'dist');
    const nodeModules = path.join(pkg.dir, 'node_modules');
    
    if (!fs.existsSync(distDir) || !fs.existsSync(nodeModules)) {
      console.log(`[Bootstrap] Preparing ${pkg.name}...`);
      try {
        if (!fs.existsSync(nodeModules)) {
          execSync('npm install', { cwd: pkg.dir, stdio: 'inherit' });
        }
        execSync('npm run build', { cwd: pkg.dir, stdio: 'inherit' });
        builtAny = true;
      } catch (err) {
        console.error(`[Bootstrap] Failed to prepare ${pkg.name}.`);
        process.exit(1);
      }
    }
  }

  // Also ensure ai-insights root has node_modules and cli-menu inside it has dist (if linked)
  const insightsModules = path.join(root, 'node_modules');
  if (builtAny || !fs.existsSync(insightsModules)) {
    console.log(`[Bootstrap] Preparing ai-insights...`);
    try {
      execSync('npm install', { cwd: root, stdio: 'inherit' });
    } catch (err) {
      console.error(`[Bootstrap] Failed to run npm install in ai-insights.`);
      process.exit(1);
    }
  }
}

bootstrap();
