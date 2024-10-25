// Script purpose - Planning and Sizing
//
// Author: Matt DeMarco (matthew.demarco@oracle.com) [PYTHON]
// Converted and Enhanced by: Tim Pirog (tim.pirog@oracle.com) [JAVASCRIPT]
//
// This script performs the following:
// 1. Enable profiling for a MongoDB database at level 2
// 2. Disable profiling for a MongoDB database
// 3. Purge profiling data for a MongoDB database
// 4. Export MongoDB profiling data to a user-specified location
// 5. Analyze exported MongoDB workload profile
// 6. Collect historical metrics on CPU, memory, storage utilization, and sessions of the database
// 7. Perform rudimentary sizing based on provided metrics JSON file
//
// Limitations:
// Cumulative Metrics: The metrics collected using serverStatus are cumulative since the last server restart

const fs = require('fs');
const { MongoClient } = require('mongodb');
const path = require('path');

// Lists based on prior definitions
const supported_keywords = [
    "$gt","$gte","$lt","$and","$not","$or","$nor","$ne","$eq","$in","$lte","$nin","$exists","$type",
    "$regex","$text","$near","$nearSphere","$size","$natural","$inc","$min","$max","$rename","$set",
    "$addToSet","$pop","$pull","$push","$pullAll","$each","$position","$sort","$bit","$count","$limit",
    "$match","$skip","$slice","$group","$project","$arrayElemAt"
];

const not_supported_keywords = [
    "$expr","$jsonSchema","$mod","$geoIntersects","$geoWithin","$box","$center","$centerSphere",
    "$maxDistance","$minDistance","$polygon","$all","$bitsAllClear","$bitsAllSet","$bitsAnyClear",
    "$bitsAnySet","$elemMatch","$rand","$currentData","$mul","$setOnInsert","$abs","$accumulator",
    "$acos","$acosh","$addFields","$bucket","$bucketAuto","$changeStream","$collStats","$currentOp",
    "$densify","$documents","$facet","$fill","$geoNear","$graphLookup","$indexStats","$lookup","$merge",
    "$out","$redact","$replaceRoot","$replaceWith","$sample","$search","$searchMeta","$setWindowFields",
    "$sortByCount","$unionWith","$unset","$unwind","$add","$allElementsTrue","$anyElementTrue",
    "$arrayToObject","$asin","$asinh","$atan","$atan2","$atanh","$avg","$binarySize","$bottom",
    "$bottomN","$bsonSize","$ceil","$cmp","$concat","$concatArrays","$cond","$convert","$cosh",
    "$covariancePop","$covarianceSamp","$dateAdd","$dateDiff","$dateFromParts","$dateFromString",
    "$datesubtract","$dateToParts","$dateToString","$dateTrunc","$dayOfMonth","$dayOfWeek",
    "$dayOfYear","$degreesToRadians","$denseRank","$derivative","$divide","$documentNumber","$exp",
    "$expMovingAvg","$filter","$first","$firstN","$floor","$function","$getField","$hour","$ifNull",
    "$indexOfArray","$indexOfBytes","$indexOfCP","$integral","$isArray","$isNumber","$isoDayOfWeek",
    "$isoWeek","$isoWeekYear","$last","$lastN","$let","$linearFill","$literal","$ln","$log","$log10",
    "$ltrim","$map","$maxN","$mergeObjects","$meta","$minN","$millisecond","$minute","$month",
    "$multiply","$objectToArray","$pow","$radiansToDegrees","$range","$rank","$reduce","$regexFind",
    "$regexFindAll","$regexMatch","$replaceOne","$replaceAll","$reverseArray","$round","$rtrim",
    "$sampleRate","$second","$setDifference","$setEquals","$setField","$setIntersection","$setIsSubset",
    "$setUnion","$shift","$sin","$sinh","$sortArray","$split","$sqrt","$stsDevPop","$stsDevSamp",
    "$strLenBytes","$strcasecmp","$strLenCP","$substr","$substrCP","$subtract","$sum","$switch",
    "$tan","$tanh","$toBool","$toDate","$toDecimal","$toDouble","$toInt","$toLong","$toObjectId",
    "$top","$topN","$toString","$toLower","$toUpper","$tsIncrement","$tsSecond","$trim","$trunc",
    "$unsetField","$week","$year","$zip"
];

// Function to load JSON data from file
function load_json(file_path) {
    const data = fs.readFileSync(file_path, 'utf8');
    return JSON.parse(data);
}

// Function to analyze keywords in the data
function analyze_keywords(data) {
    const supported_dictionary = {};
    const not_supported_dictionary = {};
    const supported_commands = [];
    const not_supported_commands = [];

    function traverse(obj, command_category) {
        if (typeof obj === 'object' && obj !== null) {
            for (let key in obj) {
                if (key.startsWith('$')) {
                    if (supported_keywords.includes(key)) {
                        supported_dictionary[key] = (supported_dictionary[key] || 0) + 1;
                    } else if (not_supported_keywords.includes(key)) {
                        not_supported_dictionary[key] = (not_supported_dictionary[key] || 0) + 1;
                        if (!command_category.includes(key)) {
                            command_category.push(key); // Mark as not supported
                        }
                    }
                }
                traverse(obj[key], command_category);
            }
        } else if (Array.isArray(obj)) {
            obj.forEach(item => traverse(item, command_category));
        }
    }

    data.forEach(entry => {
        const command_category = [];
        if (entry.op && entry.op === 'command') {
            traverse(entry, command_category);
            if (command_category.length > 0) {
                not_supported_commands.push({ entry, command_category });
            } else {
                supported_commands.push(entry);
            }
        }
    });

    return { supported_dictionary, not_supported_dictionary, supported_commands, not_supported_commands };
}

// Function to highlight unsupported keywords in JSON output
function highlight_not_supported(json_string, not_supported_keywords) {
    not_supported_keywords.forEach(keyword => {
        const regex = new RegExp(`"${keyword}"`, 'g');
        json_string = json_string.replace(regex, `<strong>"${keyword}"</strong>`);
    });
    return json_string;
}

// Function to summarize the keyword analysis
function summarize_keywords(supported_dictionary, not_supported_dictionary) {
    const total_supported = Object.values(supported_dictionary).reduce((a, b) => a + b, 0);
    const total_not_supported = Object.values(not_supported_dictionary).reduce((a, b) => a + b, 0);
    const total_keywords = total_supported + total_not_supported;

    const supported_percent = total_keywords > 0 ? (total_supported / total_keywords) * 100 : 0;

    return { total_keywords, total_supported, total_not_supported, supported_percent };
}

// Function to calculate CPU cores based on OPS/sec
function calculate_cpu_cores(opcounters, uptime_seconds, ops_per_core = 1500) {
    const total_operations = (
        opcounters.insert +
        opcounters.query +
        opcounters.update +
        opcounters.delete +
        opcounters.getmore +
        opcounters.command +
        (opcounters.deprecated ? opcounters.deprecated.query : 0)
    );
    const ops_per_sec = uptime_seconds > 0 ? total_operations / uptime_seconds : 0;
    const cpu_cores = Math.ceil(ops_per_sec / ops_per_core);
    return { total_operations, ops_per_sec, cpu_cores };
}

// Function to calculate memory requirements based on working set size
function calculate_memory_requirements(mem_stats, db_stats) {
    // Working Set Size = Total data size + index size
    let total_data_size = 0;
    let total_index_size = 0;
    for (const db in db_stats) {
        const stats = db_stats[db];
        total_data_size += stats.dataSize || 0;
        total_index_size += stats.indexSize || 0;
    }
    const working_set_size_bytes = total_data_size + total_index_size;
    const working_set_size_mb = working_set_size_bytes / (1024 * 1024);

    // Memory required with 1.5x buffer
    const memory_required_mb = Math.ceil(working_set_size_mb * 1.5);
    return { working_set_size_mb, memory_required_mb };
}

// Function to calculate storage requirements with 20% buffer
function calculate_storage_requirements(db_stats) {
    let total_storage = 0;
    for (const db in db_stats) {
        const stats = db_stats[db];
        total_storage += stats.totalSize || 0;
    }
    const storage_required_bytes = Math.ceil(total_storage * 1.2); // 20% buffer
    return storage_required_bytes;
}

// Function to calculate network bandwidth requirements
function calculate_network_bandwidth(network_stats, uptime_seconds) {
    const bytes_in = network_stats.bytesIn || 0;
    const bytes_out = network_stats.bytesOut || 0;
    const total_bytes = bytes_in + bytes_out;

    // Convert to MB
    const total_mb = total_bytes / (1024 * 1024);

    // Calculate MB/sec based on uptime
    const network_bandwidth_mb_sec = uptime_seconds > 0 ? total_mb / uptime_seconds : 0;
    return network_bandwidth_mb_sec;
}

// Function to calculate connection limits with a 50% buffer
function calculate_connection_limits(current_connections) {
    return Math.ceil(current_connections * 1.5);
}

// Function to perform sizing based on collected metrics and dbStats
function perform_sizing(metrics, db_stats) {
    // Calculate CPU cores
    const { total_operations, ops_per_sec, cpu_cores } = calculate_cpu_cores(metrics.opcounters, metrics.uptimeSeconds);

    // Calculate Memory Requirements
    const { working_set_size_mb, memory_required_mb } = calculate_memory_requirements(metrics.memory, db_stats);

    // Calculate Storage Requirements
    const storage_required_bytes = calculate_storage_requirements(db_stats);

    // Calculate Network Bandwidth
    const network_bandwidth_mb_sec = calculate_network_bandwidth(metrics.network, metrics.uptimeSeconds);

    // Calculate Connection Limits
    const connection_limits = calculate_connection_limits(metrics.connections.current);

    return {
        "Total Operations": total_operations,
        "Uptime (seconds)": metrics.uptimeSeconds,
        "Operations per Second (OPS/sec)": parseFloat(ops_per_sec.toFixed(2)),
        "CPU Cores Required": cpu_cores,
        "Working Set Size (MB)": parseFloat(working_set_size_mb.toFixed(2)),
        "Memory Required (MB)": memory_required_mb,
        "Storage Required (Bytes)": storage_required_bytes,
        "Network Bandwidth Required (MB/sec)": parseFloat(network_bandwidth_mb_sec.toFixed(6)),
        "Connection Limits": connection_limits
    };
}

// Function to summarize the sizing calculations
function summarize_sizing(sizing) {
    return `
    <h2>MongoDB Deployment Sizing Recommendations</h2>
    <table>
        <tr><td class="left-align">Total Operations</td><td class="center-align">${sizing["Total Operations"]}</td></tr>
        <tr><td class="left-align">Uptime (seconds)</td><td class="center-align">${sizing["Uptime (seconds)"]}</td></tr>
        <tr><td class="left-align">Operations per Second (OPS/sec)</td><td class="center-align">${sizing["Operations per Second (OPS/sec)"]}</td></tr>
        <tr><td class="left-align">CPU Cores Required</td><td class="center-align">${sizing["CPU Cores Required"]}</td></tr>
        <tr><td class="left-align">Working Set Size (MB)</td><td class="center-align">${sizing["Working Set Size (MB)"]}</td></tr>
        <tr><td class="left-align">Memory Required (MB)</td><td class="center-align">${sizing["Memory Required (MB)"]}</td></tr>
        <tr><td class="left-align">Storage Required (Bytes)</td><td class="center-align">${sizing["Storage Required (Bytes)"]}</td></tr>
        <tr><td class="left-align">Network Bandwidth Required (MB/sec)</td><td class="center-align">${sizing["Network Bandwidth Required (MB/sec)"]}</td></tr>
        <tr><td class="left-align">Connection Limits</td><td class="center-align">${sizing["Connection Limits"]}</td></tr>
    </table>
    `;
}

// Function to generate the report as an HTML file
function generate_html_report(supported_dictionary, not_supported_dictionary, supported_commands, not_supported_commands, output_file, metrics = null, sizing = null) {
    const { total_keywords, total_supported, total_not_supported, supported_percent } = summarize_keywords(supported_dictionary, not_supported_dictionary);

    // Start HTML content
    let html_content = `
    <html>
    <head>
        <title>MongoDB Advisor Report</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #333; }
            h2 { color: #555; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; }
            th { background-color: #f2f2f2; }
            td.left-align { text-align: left; }
            td.center-align { text-align: center; }
            .summary { background-color: #f9f9f9; padding: 10px; border: 1px solid #ddd; }
            .collapsible { background-color: #f2f2f2; cursor: pointer; padding: 10px; border: 1px solid #ddd; margin-bottom: 5px; }
            .content { display: none; padding: 10px; border: 1px solid #ddd; margin-bottom: 10px; }
            strong { color: red; }
            pre { white-space: pre-wrap; word-wrap: break-word; }
        </style>
    </head>
    <body>
        <h1>MongoDB Advisor Report</h1>
    `;

    // Conditionally include Aggregation Operators Analysis
   // if (total_keywords > 0) {
        html_content += `
        <h2>Summary of Aggregation Operators</h2>
        <p>Your operators are <strong>${supported_percent.toFixed(2)}%</strong> compatible with MongoDB API.</p>
        <table>
            <tr><td class="left-align">Total Aggregation Pipelines</td><td class="center-align">${total_keywords}</td></tr>
            <tr><td class="left-align">Total Supported Aggregation Pipelines</td><td class="center-align">${total_supported}</td></tr>
            <tr><td class="left-align">Total Not Supported Aggregation Pipelines</td><td class="center-align">${total_not_supported}</td></tr>
        </table>

        <h2>Supported Aggregation Operators</h2>
        <table>
            <tr><th>Operator</th><th>Count</th></tr>
            ${Object.entries(supported_dictionary).map(([key, value]) => `<tr><td>${key}</td><td class="center-align">${value}</td></tr>`).join('')}
        </table>

        <h2>Not Supported Aggregation Operators</h2>
        <table>
            <tr><th>Operator</th><th>Count</th></tr>
            ${Object.entries(not_supported_dictionary).map(([key, value]) => `<tr><td>${key}</td><td class="center-align">${value}</td></tr>`).join('')}
        </table>
        `;
  //  }

    // Conditionally include Sizing Recommendations
    if (sizing) {
        html_content += summarize_sizing(sizing);
    }

    // Conditionally include Supported Commands
  //  if (supported_commands.length > 0) {
        html_content += `
        <h2>Details of Supported Commands</h2>
        ${supported_commands.map((command, i) => `
        <div class="collapsible">Supported Command ${i + 1}</div>
        <div class="content"><pre>${JSON.stringify(command, null, 4)}</pre></div>
        `).join('')}
        `;
  //  }

    // Conditionally include Not Supported Commands
  //  if (not_supported_commands.length > 0) {
        html_content += `
        <h2>Details of Not Supported Commands</h2>
        ${not_supported_commands.map(({ entry, command_category }, i) => `
        <div class="collapsible">Not Supported Command ${i + 1}</div>
        <div class="content"><pre>${highlight_not_supported(JSON.stringify(entry, null, 4), command_category)}</pre></div>
        `).join('')}
        `;
//    }

    // Conditionally include Metrics
    if (metrics) {
        html_content += `
        <h2>Metrics Collected via MongoDB</h2>
        <pre>${JSON.stringify(metrics, null, 4)}</pre>
        `;
    }

    // FAQ Section
    if (!metrics) {
    html_content += `
        <h2>FAQ: Understanding the Compatibility Scores</h2>
        <div class="collapsible">How is the "Summary of Aggregation Operators" percentage calculated?</div>
        <div class="content">
            <p>The "Summary of Aggregation Operators" percentage (e.g., "Your operators are 67.09% compatible with MongoDB API") is calculated based on the ratio of supported aggregation operators to the total aggregation operators (both supported and not supported) found in the MongoDB profiler data.</p>
            <p>Here's how it works:</p>
            <ul>
                <li><strong>Step 1:</strong> Count the total occurrences of supported aggregation operators (found in the <code>supported_keywords</code> list).</li>
                <li><strong>Step 2:</strong> Count the total occurrences of not supported aggregation operators (found in the <code>not_supported_keywords</code> list).</li>
                <li><strong>Step 3:</strong> Calculate the total number of aggregation operators: <code>total_keywords = total_supported + total_not_supported</code>.</li>
                <li><strong>Step 4:</strong> Compute the compatibility percentage: <code>supported_percent = (total_supported / total_keywords) * 100</code>.</li>
            </ul>
            <p>For example, if <code>total_supported = 60</code> and <code>total_not_supported = 30</code>, then:</p>
            <p><code>supported_percent = (60 / (60 + 30)) * 100 = 66.67%</code></p>
        </div>

        <div class="collapsible">Oracle API Documentation</div>
        <div class="content">
            <p>For detailed information about supported MongoDB APIs and operations within Oracle's MongoDB API, please refer to the official Oracle documentation:</p>
            <p><a href="https://docs.oracle.com/en/database/oracle/mongodb-api/mgapi/support-mongodb-apis-operations-and-data-types-reference.html" target="_blank">Oracle API Documentation</a></p>
        </div>

        <div class="summary">
            <p><strong>Note:</strong> Operations not supported. Inserts and updates may not be accurate as they appear more in the log.</p>
        </div>

        <script>
            var coll = document.getElementsByClassName("collapsible");
            for (var i = 0; i < coll.length; i++) {
                coll[i].addEventListener("click", function() {
                    this.classList.toggle("active");
                    var content = this.nextElementSibling;
                    if (content.style.display === "block") {
                        content.style.display = "none";
                    } else {
                        content.style.display = "block";
                    }
                });
            }
        </script>
    </body>
    </html>
    `;
    }

    // Write the HTML content to the file
    fs.writeFileSync(output_file, html_content, 'utf8');
}

// MongoDB operations for profiling
async function enable_profiling(client, db_name) {
    const db = client.db(db_name);
    await db.command({ profile: 2 });
    console.log(`Profiling enabled on database '${db_name}'.`);
}

async function disable_profiling(client, db_name) {
    const db = client.db(db_name);
    await db.command({ profile: 0 });
    console.log(`Profiling disabled on database '${db_name}'.`);
}

async function purge_profiling_data(client, db_name) {
    const db = client.db(db_name);
    try {
        await db.collection('system.profile').drop();
        console.log(`Profiling data purged from database '${db_name}'.`);
    } catch (error) {
        if (error.codeName === 'NamespaceNotFound') {
            console.log(`No profiling data found in database '${db_name}'.`);
        } else {
            throw error;
        }
    }
}

async function export_profiling_data(client, db_name, output_file) {
    const db = client.db(db_name);
    const profiling_data = await db.collection('system.profile').find().toArray();
    fs.writeFileSync(output_file, JSON.stringify(profiling_data, null, 4), 'utf8');
    console.log(`Profiling data exported to '${output_file}'.`);
}

// Function to collect cumulative metrics since the last reset of the database
async function collect_lifetime_metrics(client, output_file) {
    const adminDb = client.db('admin');

    // Get server status with necessary fields
    const serverStatus = await adminDb.command({ serverStatus: 1, repl: 1, wiredTiger: 1 });

    // Get cumulative metrics
    const metrics = {
        timestamp: new Date().toISOString(),
        uptimeSeconds: serverStatus.uptime, // Uptime in seconds
        connections: serverStatus.connections,
        opcounters: serverStatus.opcounters, // Cumulative operation counters
        opcountersRepl: serverStatus.opcountersRepl, // For replica sets
        network: serverStatus.network, // Network statistics
        mem: serverStatus.mem, // Memory usage
        extra_info: serverStatus.extra_info, // May include CPU info on some platforms
        metrics: serverStatus.metrics, // Detailed metrics
        wiredTiger: serverStatus.wiredTiger, // WiredTiger engine stats
        logicalSessionRecordCache: serverStatus.logicalSessionRecordCache, // Session information
        // Add other relevant fields as needed
    };

    // Get database statistics
    const databases = await adminDb.admin().listDatabases();

    const dbStats = {};
    for (const dbInfo of databases.databases) {
        const db = client.db(dbInfo.name);
        const stats = await db.command({ dbStats: 1, scale: 1 });
        dbStats[dbInfo.name] = stats;
    }

    // Include database stats
    metrics.dbStats = dbStats;

    fs.writeFileSync(output_file, JSON.stringify(metrics, null, 4), 'utf8');
    console.log(`Metrics collected and saved to '${output_file}'.`);
}


// Main function
async function main() {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    function question(query) {
        return new Promise(resolve => rl.question(query, resolve));
    }

    // Prompt user for mode
    console.log("Select an operation mode:");
    console.log("1: Enable profiling for the MongoDB database");
    console.log("2: Disable profiling for the MongoDB database");
    console.log("3: Purge profiling data for the MongoDB database");
    console.log("4: Export profiling data to a JSON file");
    console.log("5: Analyze a MongoDB profile JSON file");
    console.log("6: Collect historical metrics via MongoDB native commands");
    console.log("7: Perform sizing based on a metrics JSON file");

    const mode = await question("Enter the mode number: ");

    // Handle different modes
    if (mode === "1") {
        // Enable profiling
        const connection_string = await question("Enter the MongoDB connection string (e.g., mongodb://localhost:27017): ");
        const client = new MongoClient(connection_string);
        try {
            await client.connect();
            const db_name = await question("Enter the database name: ");
            await enable_profiling(client, db_name);
        } catch (error) {
            console.error("Error enabling profiling:", error.message);
        } finally {
            await client.close();
        }
    } else if (mode === "2") {
        // Disable profiling
        const connection_string = await question("Enter the MongoDB connection string (e.g., mongodb://localhost:27017): ");
        const client = new MongoClient(connection_string);
        try {
            await client.connect();
            const db_name = await question("Enter the database name: ");
            await disable_profiling(client, db_name);
        } catch (error) {
            console.error("Error disabling profiling:", error.message);
        } finally {
            await client.close();
        }
    } else if (mode === "3") {
        // Purge profiling data
        const connection_string = await question("Enter the MongoDB connection string (e.g., mongodb://localhost:27017): ");
        const client = new MongoClient(connection_string);
        try {
            await client.connect();
            const db_name = await question("Enter the database name: ");
            await purge_profiling_data(client, db_name);
        } catch (error) {
            console.error("Error purging profiling data:", error.message);
        } finally {
            await client.close();
        }
    } else if (mode === "4") {
        // Export profiling data
        const connection_string = await question("Enter the MongoDB connection string (e.g., mongodb://localhost:27017): ");
        const client = new MongoClient(connection_string);
        try {
            await client.connect();
            const db_name = await question("Enter the database name: ");
            const output_file = await question("Enter the output JSON file name (e.g., profiling_data.json): ");
            await export_profiling_data(client, db_name, output_file);
        } catch (error) {
            console.error("Error exporting profiling data:", error.message);
        } finally {
            await client.close();
        }
    } else if (mode === "5") {
        // Analyze profiling data
        const profile_file_path = await question("Enter the path to the MongoDB profile JSON file: ");
        if (!fs.existsSync(profile_file_path)) {
            console.log("Profile file does not exist. Please check the path and try again.");
            rl.close();
            return;
        }
        const profile_data = load_json(profile_file_path);

        // Analyze the keywords in the JSON data
        const { supported_dictionary, not_supported_dictionary, supported_commands, not_supported_commands } = analyze_keywords(profile_data);

        // Create the output file name with timestamp
        const timestamp = new Date().toISOString().replace(/:/g, '_').replace(/\..+/, '');
        const base_name = path.basename(profile_file_path, path.extname(profile_file_path));
        const output_file = `${base_name}_report_advisor_${timestamp}.html`;

        // Generate HTML report without sizing
        generate_html_report(supported_dictionary, not_supported_dictionary, supported_commands, not_supported_commands, output_file, null, null);

        console.log(`HTML report has been generated and saved as '${output_file}'.`);
    } else if (mode === "6") {
        // Collect historical metrics
        const connection_string = await question("Enter the MongoDB connection string (e.g., mongodb://localhost:27017): ");
        const client = new MongoClient(connection_string);
        try {
            await client.connect();
            const output_file = await question("Enter the output JSON file name for metrics (e.g., metrics.json): ");
            await collect_lifetime_metrics(client, output_file);
        } catch (error) {
            console.error("Error collecting metrics:", error.message);
        } finally {
            await client.close();
        }
    } else if (mode === "7") {
        // Perform sizing based on metrics JSON file
        const metrics_file_path = await question("Enter the path to the metrics JSON file: ");
        if (!fs.existsSync(metrics_file_path)) {
            console.log("Metrics file does not exist. Please check the path and try again.");
            rl.close();
            return;
        }
        const metrics_data = load_json(metrics_file_path);

        // Validate required fields
        const required_fields = ['opcounters', 'uptimeSeconds', 'connections', 'mem', 'network', 'dbStats'];
        const missing_fields = required_fields.filter(field => !(field in metrics_data));
        if (missing_fields.length > 0) {
            console.log(`Metrics JSON file is missing required fields: ${missing_fields.join(', ')}`);
            rl.close();
            return;
        }

        // Perform sizing
        const sizing = perform_sizing(metrics_data, metrics_data.dbStats);

        // Create the output file name with timestamp
        const timestamp = new Date().toISOString().replace(/:/g, '_').replace(/\..+/, '');
        const base_name = path.basename(metrics_file_path, path.extname(metrics_file_path));
        const output_file = `${base_name}_sizing_report_${timestamp}.html`;

        // Generate HTML report with sizing only (no aggregation operators)
        generate_html_report({}, {}, [], [], output_file, metrics_data, sizing);

        console.log(`Sizing report has been generated and saved as '${output_file}'.`);
    } else {
        console.log("Invalid mode selected.");
    }

    rl.close();
}

main().catch(err => {
    console.error("An error occurred:", err);
});
