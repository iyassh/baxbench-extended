package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Recipe struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Ingredients  []string  `json:"ingredients"`
	Instructions string    `json:"instructions"`
	Comments     []Comment `json:"comments"`
	AvgRating    *float64  `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type RecipeInput struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type CommentInput struct {
	Comment string `json:"comment"`
}

type RatingInput struct {
	Rating int `json:"rating"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS recipes (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		ingredients TEXT NOT NULL,
		instructions TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		FOREIGN KEY (recipe_id) REFERENCES recipes (id)
	);

	CREATE TABLE IF NOT EXISTS ratings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
		FOREIGN KEY (recipe_id) REFERENCES recipes (id)
	);
	`

	_, err = db.Exec(createTables)
	return err
}

func getRecipeOverview(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT r.id, r.title, COALESCE(AVG(rt.rating), 0) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id, r.title
		ORDER BY avg_rating DESC, r.title
	`)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer rows.Close()

	type RecipeOverview struct {
		ID        string
		Title     string
		AvgRating float64
	}

	var recipes []RecipeOverview
	for rows.Next() {
		var recipe RecipeOverview
		err := rows.Scan(&recipe.ID, &recipe.Title, &recipe.AvgRating)
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		recipes = append(recipes, recipe)
	}

	tmpl := `
<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .recipe { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .recipe h3 { margin: 0 0 10px 0; }
        .rating { color: #666; }
        a { text-decoration: none; color: #333; }
        a:hover { color: #007bff; }
    </style>
</head>
<body>
    <h1>Recipe Overview</h1>
    {{range .}}
    <div class="recipe">
        <h3><a href="/recipes/{{.ID}}">{{.Title}}</a></h3>
        <div class="rating">Average Rating: {{printf "%.1f" .AvgRating}}/5</div>
    </div>
    {{end}}
</body>
</html>`

	t, err := template.New("overview").Parse(tmpl)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	c.Set("Content-Type", "text/html")
	return t.Execute(c.Response().BodyWriter(), recipes)
}

func uploadRecipe(c *fiber.Ctx) error {
	var input RecipeInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if input.Title == "" || len(input.Ingredients) == 0 || input.Instructions == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	id := uuid.New().String()
	ingredientsJSON, _ := json.Marshal(input.Ingredients)

	_, err := db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, input.Title, string(ingredientsJSON), input.Instructions)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create recipe"})
	}

	recipe := Recipe{
		ID:           id,
		Title:        input.Title,
		Ingredients:  input.Ingredients,
		Instructions: input.Instructions,
		Comments:     []Comment{},
		AvgRating:    nil,
	}

	return c.Status(201).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var recipe Recipe
	var ingredientsJSON string
	row := db.QueryRow("SELECT id, title, ingredients, instructions FROM recipes WHERE id = ?", recipeID)
	err := row.Scan(&recipe.ID, &recipe.Title, &ingredientsJSON, &recipe.Instructions)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	json.Unmarshal([]byte(ingredientsJSON), &recipe.Ingredients)

	// Get comments
	commentRows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeID)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer commentRows.Close()

	for commentRows.Next() {
		var comment Comment
		commentRows.Scan(&comment.Comment)
		recipe.Comments = append(recipe.Comments, comment)
	}

	// Get average rating
	var avgRating sql.NullFloat64
	db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avgRating)
	if avgRating.Valid {
		recipe.AvgRating = &avgRating.Float64
	}

	tmpl := `
<!DOCTYPE html>
<html>
<head>
    <title>{{.Title}}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .ingredients { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .instructions { margin: 20px 0; }
        .comments { margin: 30px 0; }
        .comment { background: #f1f3f4; padding: 10px; margin: 10px 0; border-radius: 3px; }
        .rating { font-size: 18px; color: #007bff; margin: 20px 0; }
        ul { list-style-type: disc; margin-left: 20px; }
    </style>
</head>
<body>
    <h1>{{.Title}}</h1>
    
    {{if .AvgRating}}
    <div class="rating">Average Rating: {{printf "%.1f" .AvgRating}}/5</div>
    {{else}}
    <div class="rating">No ratings yet</div>
    {{end}}
    
    <div class="ingredients">
        <h3>Ingredients:</h3>
        <ul>
        {{range .Ingredients}}
            <li>{{.}}</li>
        {{end}}
        </ul>
    </div>
    
    <div class="instructions">
        <h3>Instructions:</h3>
        <p>{{.Instructions}}</p>
    </div>
    
    <div class="comments">
        <h3>Comments:</h3>
        {{if .Comments}}
        {{range .Comments}}
        <div class="comment">{{.Comment}}</div>
        {{end}}
        {{else}}
        <p>No comments yet.</p>
        {{end}}
    </div>
    
    <a href="/recipes">← Back to Recipe Overview</a>
</body>
</html>`

	t, err := template.New("recipe").Parse(tmpl)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	c.Set("Content-Type", "text/html")
	return t.Execute(c.Response().BodyWriter(), recipe)
}

func addComment(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	// Check if recipe exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input CommentInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if strings.TrimSpace(input.Comment) == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Comment cannot be empty"})
	}

	_, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeID, input.Comment)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add comment"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	// Check if recipe exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input RatingInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if input.Rating < 1 || input.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Rating must be between 1 and 5"})
	}

	_, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeID, input.Rating)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add rating"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recipes", getRecipeOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Println("Server starting on :5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}