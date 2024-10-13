# oee-mongo

v0.0.1 - PoC

    Performs MongoDB profiling operations and analyzes the profiling data to generate an HTML report. 

JS conversion of [MongoDB compatibility advisor for Autonomous MongoDB API](https://github.com/oracle-devrel/technology-engineering/tree/main/data-platform/autonomous-database/autonomous-json/mongodb-compatibility-advisor-19c)


Install:

`npm install mongodb`

How to use:

`node mongoAssess.js`

    Example script for the Planning phase of a migration focused on reviewing MongoDB operations relative to 23ai support
    This script can do the following:
    1. Enable profiling for a MongoDB database at level 2 (https://www.mongodb.com/docs/manual/reference/command/profile/#std-label-profile-command)
    2. Disable profiling for a MongoDB database
    3. Purge profiling data for a MongoDB database
    4. Export MongoDB profiling data to user specified location
    5. Analyze exported MongoDB workload profile
