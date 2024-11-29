# oee-mongo

**Version:** v0.0.1  
**Status:** Proof of Concept (PoC)  

This tool extends functionality with new **Option 6** and **Option 7**, introducing metrics collection and a basic size reporting feature.  

### Features:

- **Enhanced Capabilities:**  
  - A JavaScript-based conversion of the [MongoDB Compatibility Advisor for Autonomous MongoDB API](https://github.com/oracle-devrel/technology-engineering/tree/main/data-platform/autonomous-database/autonomous-json/mongodb-compatibility-advisor-19c), enriched with additional features like basic metrics collection and sizing.

- **MongoDB Profiling and Analysis:**  
  - Executes profiling operations on MongoDB databases
  - Collects profiling data and performance metrics.  

- **Data Analysis and Reporting:**  
  - Analyzes the collected data to generate basic HTML reports, offering insights into database useage patterns, sizing requirements, and MongoDB API Compatibility.

Install:

`npm install`

How to use:

`node mongoAssess.js`

    Example script for the Planning phase of a migration focused on reviewing MongoDB operations relative to 23ai support
    This script can do the following:
    1. Enable profiling for a MongoDB database at level 2 (https://www.mongodb.com/docs/manual/reference/command/profile/#std-label-profile-command)
    2. Disable profiling for a MongoDB database
    3. Purge profiling data for a MongoDB database
    4. Export MongoDB profiling data to user specified location
    5. Analyze exported MongoDB workload profile
    6. Collect historical metrics on CPU, memory, storage utilization, and sessions of the database
    7. Perform rudimentary sizing based on provided metrics JSON file
