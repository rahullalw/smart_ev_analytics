import { DataGenerator } from './data-generator.service';

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'single';
  const deviceCount = parseInt(args[1]) || 10;

  const generator = new DataGenerator(deviceCount);

  switch (mode) {
    case 'single':
      console.log('\n=== Single Batch Test ===\n');
      await generator.sendSingleBatch();
      break;

    case 'load':
      const duration = parseInt(args[2]) || 120; // 2 minutes default
      console.log(`\n=== Load Test (${duration}s) ===\n`);
      await generator.generateLoad(duration);
      break;

    case 'mapping':
      console.log('\n=== Creating Mappings ===\n');
      await generator.createMappings();
      break;

    case 'full':
      console.log('\n=== Full Test Suite ===\n');
      console.log('\n1. Creating vehicle-meter mappings...');
      await generator.createMappings();
      
      console.log('\n2. Sending initial batch of telemetry...');
      await generator.sendSingleBatch();
      
      console.log('\n3. Waiting 2 seconds...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('\n4. Sending second batch...');
      await generator.sendSingleBatch();
      
      console.log('\n✅ Full test complete!');
      console.log('\nYou can now test analytics endpoint with:');
      console.log(`curl http://localhost:3000/v1/analytics/performance/11111111-1111-1111-1111-000000000000`);
      break;

    default:
      console.log('Usage: npm run test:load [mode] [deviceCount] [duration]');
      console.log('\nModes:');
      console.log('  single   - Send one batch of telemetry (default)');
      console.log('  load     - Run continuous load test');
      console.log('  mapping  - Create vehicle-meter mappings');
      console.log('  full     - Run full test suite');
      console.log('\nExamples:');
      console.log('  npm run test:load single 10');
      console.log('  npm run test:load load 100 180');
      console.log('  npm run test:load mapping 10');
      console.log('  npm run test:load full 10');
      break;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
