<!DOCTYPE html>
<html>
<head>
<style>
body {
    background-image: url("website.png");
    background-size: cover;
    text-align: center;
}
h1 {
    font-size: 4em;
    color: #ff0000; /* Red */
    text-shadow: 0 0 20px #ff0000; /* Red */
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    -webkit-animation: rainbow 4s ease-in-out infinite;
}

@-webkit-keyframes rainbow {
    0% {
        color: #ff0000; /* Red */
    }
    20% {
        color: #ffa500; /* Orange */
    }
    40% {
        color: #ffff00; /* Yellow */
    }
    60% {
        color: #00ff00; /* Green */
    }
    80% {
        color: #0000ff; /* Blue */
    }
    100% {
        color: #ff00ff; /* Purple */
    }
}

</style>
</head>
<body>
<h1>Welcome to my website</h1>
<p>Here you can find my personal portfolio and project/interest blog. I'll be posting code snippets and updates on projects related to AI, web development, and cyber security. Additionally, I'll be sharing things that I find generally interesting in these areas.</p>
</body>
</html>
