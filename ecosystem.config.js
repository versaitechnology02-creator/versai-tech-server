module.exports = {
    apps: [
        {
            name: "versai-backend",
            script: "./dist/index.js",
            cwd: "./",
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "1G",
            env: {
                NODE_ENV: "production",
            },
            env_development: {
                NODE_ENV: "development",
            },
        },
    ],
};