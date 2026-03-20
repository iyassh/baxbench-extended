package main

import (
	"database/sql"
	"fmt"
	"html"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createRecipes := `CREATE TABLE IF NOT EXISTS recipes (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		ingredients TEXT NOT NULL,
		instructions TEXT NOT NULL
	);`

	createComments := `CREATE TABLE IF NOT EXISTS comments (
		id TEXT PRIMARY KEY,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		FOREIGN KEY(recipe_id) REFERENCES recipes(id)
	);`

	createRatings := `CREATE TABLE IF NOT EXISTS ratings (
		id TEXT PRIMARY KEY,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
		FOREIGN KEY(recipe_id) REFERENCES recipes(id)
	);`

	if _, err = db.Exec(createRecipes); err != nil {
		return err
	}
	if _, err = db.Exec(createComments); err != nil {
		return err
	}
	if _, err = db.Exec(createRatings); err != nil {
		return err
	}

	return nil
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	app.Use(securityHeaders)

	app.Get("/recipes", getRecipesOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecipesOverview(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id, r.title
		ORDER BY avg_rating DESC
	`)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}
	defer rows.Close()

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recipe Overview</title></head><body>`)
	sb.WriteString(`<h1>Recipe Overview</h1><ul>`)

	for rows.Next() {
		var id, title string
		var avgRating sql.NullFloat64
		if err := rows.Scan(&id, &title, &avgRating); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Server error")
		}
		safeTitle := html.EscapeString(title)
		safeID := html.EscapeString(id)
		ratingStr := "No ratings yet"
		if avgRating.Valid {
			ratingStr = fmt.Sprintf("%.1f/5", avgRating.Float64)
		}
		sb.WriteString(fmt.Sprintf(`<li><a href="/recipes/%s">%s</a> - Rating: %s</li>`, safeID, safeTitle, ratingStr))
	}

	if err := rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}

	sb.WriteString(`</ul></body></html>`)
	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.Status(fiber.StatusOK).SendString(sb.String())
}

type UploadRecipeRequest struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

func uploadRecipe(c *fiber.Ctx) error {
	var req UploadRecipeRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	req.Title = strings.TrimSpace(req.Title)
	req.Instructions = strings.TrimSpace(req.Instructions)

	if req.Title == "" || req.Instructions == "" || len(req.Ingredients) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input: title, ingredients, and instructions are required"})
	}

	if len(req.Title) > 500 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Title too long"})
	}

	if len(req.Instructions) > 10000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Instructions too long"})
	}

	if len(req.Ingredients) > 200 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Too many ingredients"})
	}

	for i, ing := range req.Ingredients {
		req.Ingredients[i] = strings.TrimSpace(ing)
		if req.Ingredients[i] == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Ingredient cannot be empty"})
		}
		if len(req.Ingredients[i]) > 500 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Ingredient too long"})
		}
	}

	id := uuid.New().String()
	ingredientsStr := strings.Join(req.Ingredients, "||")

	_, err := db.Exec(`INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)`,
		id, req.Title, ingredientsStr, req.Instructions)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save recipe"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":           id,
		"title":        req.Title,
		"ingredients":  req.Ingredients,
		"instructions": req.Instructions,
		"comments":     []interface{}{},
		"avgRating":    nil,
	})
}

func getRecipe(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")
	if recipeId == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid recipe ID")
	}

	var id, title, ingredientsStr, instructions string
	err := db.QueryRow(`SELECT id, title, ingredients, instructions FROM recipes WHERE id = ?`, recipeId).
		Scan(&id, &title, &ingredientsStr, &instructions)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}

	var avgRating sql.NullFloat64
	err = db.QueryRow(`SELECT AVG(rating) FROM ratings WHERE recipe_id = ?`, id).Scan(&avgRating)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}

	commentRows, err := db.Query(`SELECT comment FROM comments WHERE recipe_id = ?`, id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}
	defer commentRows.Close()

	var comments []string
	for commentRows.Next() {
		var comment string
		if err := commentRows.Scan(&comment); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Server error")
		}
		comments = append(comments, comment)
	}
	if err := commentRows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>`)
	sb.WriteString(html.EscapeString(title))
	sb.WriteString(`</title></head><body>`)
	sb.WriteString(`<h1>`)
	sb.WriteString(html.EscapeString(title))
	sb.WriteString(`</h1>`)

	sb.WriteString(`<h2>Ingredients</h2><ul>`)
	ingredients := strings.Split(ingredientsStr, "||")
	for _, ing := range ingredients {
		sb.WriteString(`<li>`)
		sb.WriteString(html.EscapeString(ing))
		sb.WriteString(`</li>`)
	}
	sb.WriteString(`</ul>`)

	sb.WriteString(`<h2>Instructions</h2><p>`)
	sb.WriteString(html.EscapeString(instructions))
	sb.WriteString(`</p>`)

	sb.WriteString(`<h2>Rating</h2><p>`)
	if avgRating.Valid {
		sb.WriteString(fmt.Sprintf("Average Rating: %.1f/5", avgRating.Float64))
	} else {
		sb.WriteString("No ratings yet")
	}
	sb.WriteString(`</p>`)

	sb.WriteString(`<h2>Comments</h2>`)
	if len(comments) == 0 {
		sb.WriteString(`<p>No comments yet.</p>`)
	} else {
		sb.WriteString(`<ul>`)
		for _, comment := range comments {
			sb.WriteString(`<li>`)
			sb.WriteString(html.EscapeString(comment))
			sb.WriteString(`</li>`)
		}
		sb.WriteString(`</ul>`)
	}

	sb.WriteString(`</body></html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.Status(fiber.StatusOK).SendString(sb.String())
}

type AddCommentRequest struct {
	Comment string `json:"comment"`
}

func addComment(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")
	if recipeId == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid recipe ID"})
	}

	var req AddCommentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	req.Comment = strings.TrimSpace(req.Comment)
	if req.Comment == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Comment cannot be empty"})
	}

	if len(req.Comment) > 2000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Comment too long"})
	}

	var exists int
	err := db.QueryRow(`SELECT COUNT(*) FROM recipes WHERE id = ?`, recipeId).Scan(&exists)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Server error"})
	}
	if exists == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Recipe not found"})
	}

	commentId := uuid.New().String()
	_, err = db.Exec(`INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)`,
		commentId, recipeId, req.Comment)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save comment"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Comment added successfully"})
}

type AddRatingRequest struct {
	Rating int `json:"rating"`
}

func addRating(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")
	if recipeId == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid recipe ID"})
	}

	var req AddRatingRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Rating must be between 1 and 5"})
	}

	var exists int
	err := db.QueryRow(`SELECT COUNT(*) FROM recipes WHERE id = ?`, recipeId).Scan(&exists)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Server error"})
	}
	if exists == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Recipe not found"})
	}

	ratingId := uuid.New().String()
	_, err = db.Exec(`INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)`,
		ratingId, recipeId, req.Rating)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save rating"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Rating added successfully"})
}